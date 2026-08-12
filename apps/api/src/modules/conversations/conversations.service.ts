import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AiMode,
  ConversationChannel,
  ConversationPriority,
  ConversationStatus,
  MessageSenderType,
  MessageStatus,
  MessageType,
  Prisma,
} from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { AiEngineService } from '../ai/ai-engine.service';
import { CustomersService } from '../customers/customers.service';
import { InboxSettingsService } from '../inbox-settings/inbox-settings.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  isAcceptedAudio,
  remuxToOggOpus,
} from '../whatsapp/audio-container';
import { WhatsappMediaService } from '../whatsapp/whatsapp-media.service';
import { WhatsappSenderService } from '../whatsapp/whatsapp-sender.service';

const OPEN_STATUSES: ConversationStatus[] = [
  'OPEN',
  'WAITING_CUSTOMER',
  'WAITING_AGENT',
];

// Ordem de progressão do ciclo de entrega — usada só pra impedir que um
// webhook fora de ordem faça o status andar pra trás. FAILED fica no topo
// porque é terminal: se a Meta disse que falhou, não volta pra "entregue".
const STATUS_RANK: Record<MessageStatus, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
};

/**
 * A Cloud API não tem um tipo "anexo" genérico: cada mídia vai num campo
 * próprio. O que não for imagem/áudio/vídeo conhecido vai como documento,
 * que é o balde que aceita qualquer coisa.
 */
function mediaKindFor(mimeType: string): 'image' | 'document' | 'audio' | 'video' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

const MEDIA_MESSAGE_TYPE: Record<
  'image' | 'document' | 'audio' | 'video',
  MessageType
> = {
  image: 'IMAGE',
  document: 'DOCUMENT',
  audio: 'AUDIO',
  video: 'VIDEO',
};

const conversationInclude = {
  customer: true,
  assignedUser: { select: { id: true, name: true, email: true, avatar: true } },
  queue: { select: { id: true, key: true, name: true } },
  // Prévia da última mensagem — é o que faz a lista parecer um mensageiro
  // em vez de uma tabela de chamados. Uma só, a mais recente.
  messages: {
    take: 1,
    orderBy: { createdAt: 'desc' },
    select: { content: true, senderType: true, messageType: true },
  },
} as const;

/**
 * O include traz a última mensagem dentro de `messages`, mas esse nome
 * colide com o histórico completo do detalhe da conversa — o painel faz
 * `{...detalhe, ...resumo}` ao receber um evento, e o array de um item
 * sobrescreveria o histórico inteiro. Por isso vira `lastMessage`.
 */
function toSummary<T extends { messages: unknown[] }>(conversation: T) {
  const { messages, ...rest } = conversation;
  return { ...rest, lastMessage: messages[0] ?? null };
}

// A mensagem citada vem junto, mas só com o essencial pra desenhar a
// tarjinha de citação — sem isso a tela teria que caçar a original, que
// pode nem estar na página carregada.
const messageInclude = {
  replyTo: {
    select: {
      id: true,
      content: true,
      senderType: true,
      messageType: true,
    },
  },
} as const;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly customers: CustomersService,
    private readonly realtime: RealtimeGateway,
    private readonly aiEngine: AiEngineService,
    private readonly whatsapp: WhatsappSenderService,
    private readonly media: WhatsappMediaService,
    private readonly inboxSettings: InboxSettingsService,
  ) {}

  /**
   * Sempre ordenada por mensagem mais recente — é o que todo mensageiro faz
   * e o que a memória muscular espera. Prioridade é filtro, não ordenação:
   * uma conversa urgente de ontem embaixo de uma normal de agora só
   * confunde quem está atendendo.
   *
   * Paginação por cursor (e não offset) porque a lista muda embaixo do
   * usuário o tempo todo: com offset, uma conversa que sobe pro topo faria
   * a página seguinte repetir ou pular itens.
   */
  async list(filter: {
    status?: ConversationStatus;
    assignedUserId?: string;
    queueId?: string;
    customerId?: string;
    priority?: ConversationPriority;
    unreadOnly?: boolean;
    unassignedOnly?: boolean;
    search?: string;
    cursor?: string;
    limit?: number;
  }) {
    const take = Math.min(Math.max(filter.limit ?? 30, 1), 100);
    const search = filter.search?.trim();

    const items = await this.prisma.db.conversation.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.assignedUserId
          ? { assignedUserId: filter.assignedUserId }
          : {}),
        ...(filter.queueId ? { queueId: filter.queueId } : {}),
        ...(filter.customerId ? { customerId: filter.customerId } : {}),
        ...(filter.priority ? { priority: filter.priority } : {}),
        ...(filter.unreadOnly ? { unreadCount: { gt: 0 } } : {}),
        ...(filter.unassignedOnly ? { assignedUserId: null } : {}),
        ...(search
          ? {
              customer: {
                is: {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { phone: { contains: search } },
                  ],
                },
              },
            }
          : {}),
      },
      include: conversationInclude,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });

    // Pedimos um a mais só pra saber se existe próxima página, sem precisar
    // de um count() separado.
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;

    return {
      items: page.map(toSummary),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /** Contadores de cada filtro, calculados no banco pra não depender da página carregada. */
  async counts(userId: string) {
    const [total, unread, mine, unassigned, byStatus, byPriority] =
      await Promise.all([
        this.prisma.db.conversation.count(),
        this.prisma.db.conversation.count({ where: { unreadCount: { gt: 0 } } }),
        this.prisma.db.conversation.count({ where: { assignedUserId: userId } }),
        this.prisma.db.conversation.count({ where: { assignedUserId: null } }),
        this.prisma.db.conversation.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.db.conversation.groupBy({
          by: ['priority'],
          _count: { _all: true },
        }),
      ]);

    return {
      total,
      unread,
      mine,
      unassigned,
      status: Object.fromEntries(
        byStatus.map((row) => [row.status, row._count._all]),
      ),
      priority: Object.fromEntries(
        byPriority.map((row) => [row.priority, row._count._all]),
      ),
    };
  }

  /**
   * Mensagens de uma conversa, da mais nova pra mais velha e com cursor —
   * é assim que a rolagem infinita pra cima funciona sem carregar cinco
   * anos de histórico na primeira abertura. A tela reverte a ordem.
   */
  async listMessages(
    conversationId: string,
    options: { cursor?: string; limit?: number } = {},
  ) {
    await this.requireConversationExists(conversationId);
    const take = Math.min(Math.max(options.limit ?? 40, 1), 100);

    const items = await this.prisma.db.message.findMany({
      where: { conversationId },
      include: messageInclude,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;

    return {
      items: [...page].reverse(),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  private async requireConversationExists(id: string) {
    const exists = await this.prisma.db.conversation.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Conversa não encontrada.');
    }
    return exists;
  }

  private async requireConversation(id: string) {
    const conversation = await this.prisma.db.conversation.findFirst({
      where: { id },
      include: {
        ...conversationInclude,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada.');
    }
    return conversation;
  }

  /**
   * Abrir a conversa é o que marca ela como lida — é o gesto que significa
   * "alguém viu isso". Só emite o evento quando havia algo pra zerar, pra
   * não inundar o painel com atualizações a cada clique.
   */
  async getById(id: string) {
    const conversation = await this.prisma.db.conversation.findFirst({
      where: { id },
      include: conversationInclude,
    });
    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada.');
    }

    // Só a página mais recente: uma conversa de meses não pode travar a
    // abertura carregando tudo. O resto sobe conforme a pessoa rola.
    const messages = await this.listMessages(id);

    if (conversation.unreadCount > 0) {
      const updated = await this.prisma.db.conversation.update({
        where: { id },
        data: { unreadCount: 0 },
        include: conversationInclude,
      });
      this.realtime.emitToTenant(
        this.prisma.tenantId,
        'conversation.updated',
        toSummary(updated),
      );
      // Avisa a Meta que a empresa leu — só se a empresa quiser revelar
      // isso (ver InboxSettings.sendReadReceipts).
      void this.markConversationRead(id);
    }

    return {
      ...conversation,
      unreadCount: 0,
      messages: messages.items,
      messagesCursor: messages.nextCursor,
    };
  }

  /**
   * Marca a última mensagem recebida como lida na Meta. Falha aqui é
   * silenciosa de propósito: não conseguir acender o tique azul não pode
   * atrapalhar quem está abrindo a conversa.
   */
  private async markConversationRead(conversationId: string) {
    const settings = await this.inboxSettings.get();
    if (!settings.sendReadReceipts) return;

    const lastInbound = await this.prisma.db.message.findFirst({
      where: { conversationId, senderType: 'CUSTOMER', externalId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { externalId: true },
    });
    if (lastInbound?.externalId) {
      await this.whatsapp.markAsRead(lastInbound.externalId);
    }
  }

  async setPriority(conversationId: string, priority: ConversationPriority) {
    await this.requireConversation(conversationId);
    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: { priority },
      include: conversationInclude,
    });
    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(conversation),
    );
    return conversation;
  }

  /**
   * Grava uma mensagem (de quem for) e atualiza a conversa de forma
   * consistente: quando quem fala é o cliente, a conversa fica OPEN
   * (esperando alguém/algo responder); quando quem fala é a empresa
   * (atendente ou IA), fica WAITING_CUSTOMER. Emite os dois eventos de
   * tempo real sempre da mesma forma, então painel nunca fica desatualizado
   * não importa qual caminho gerou a mensagem.
   */
  private async persistMessage(
    conversationId: string,
    data: {
      senderType: MessageSenderType;
      senderId?: string;
      content: string;
      messageType?: MessageType;
      metadata?: Prisma.InputJsonValue;
      externalId?: string;
      replyToId?: string;
    },
  ) {
    const before = await this.prisma.db.conversation.findFirst({
      where: { id: conversationId },
      select: { status: true, aiMode: true },
    });

    const message = await this.prisma.db.message.create({
      data: { tenantId: this.prisma.tenantId, conversationId, ...data },
      include: messageInclude,
    });

    const fromCustomer = data.senderType === 'CUSTOMER';
    // Nota interna do sistema (ex: aviso de transferência de fila) não muda
    // de quem é a vez nem conta como mensagem a ler — antes ela empurrava a
    // conversa pra "aguardando cliente" mesmo tendo acabado de cair no colo
    // de um atendente.
    const isSystemNote = data.senderType === 'SYSTEM';

    // A IA transfere e, na mesma rodada, ainda manda um "já te encaminhei,
    // um momento". Essa despedida NÃO pode desfazer a transferência: sem
    // isto, a conversa voltava pra "aguardando cliente" logo depois de cair
    // na fila do time e ninguém a via como pendente de atendimento.
    const alreadyHandedOff =
      data.senderType === 'AI' &&
      (before?.status === 'WAITING_AGENT' || before?.aiMode === 'HUMAN_ACTIVE');

    const status: ConversationStatus | undefined =
      isSystemNote || alreadyHandedOff
        ? undefined
        : fromCustomer
          ? 'OPEN'
          : 'WAITING_CUSTOMER';

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: message.createdAt,
        ...(status ? { status } : {}),
        ...(fromCustomer
          ? { unreadCount: { increment: 1 } }
          : isSystemNote
            ? {}
            : { unreadCount: 0 }),
      },
      include: conversationInclude,
    });

    this.realtime.emitToTenant(this.prisma.tenantId, 'message.created', {
      conversationId,
      message,
    });
    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(conversation),
    );

    // Só ecoa pro WhatsApp respostas da empresa (IA ou atendente) — mensagens
    // do próprio cliente óbvio não, e mensagens SYSTEM (ex: aviso de
    // transferência de fila) são notas internas pro time, não pro cliente.
    if (
      conversation.channel === 'WHATSAPP' &&
      (data.senderType === 'AI' || data.senderType === 'AGENT')
    ) {
      const quoted = data.replyToId
        ? await this.prisma.db.message.findFirst({
            where: { id: data.replyToId },
            select: { externalId: true },
          })
        : null;

      const externalId = await this.whatsapp.sendText(
        conversation.customer.phone,
        data.content,
        quoted?.externalId,
      );
      if (externalId) {
        await this.prisma.db.message.update({
          where: { id: message.id },
          data: { externalId },
        });
      }
    }

    return { message, conversation };
  }

  /**
   * Aplica um evento de status vindo do webhook do WhatsApp (entregue, lido,
   * falhou) na mensagem correspondente. Nunca regride o status: a Meta não
   * garante ordem de entrega dos webhooks, então um "delivered" atrasado
   * chegando depois de um "read" não pode apagar o tique azul.
   */
  async applyDeliveryStatus(externalId: string, status: MessageStatus) {
    const message = await this.prisma.db.message.findFirst({
      where: { externalId },
    });
    if (!message || STATUS_RANK[status] <= STATUS_RANK[message.status]) {
      return;
    }

    const updated = await this.prisma.db.message.update({
      where: { id: message.id },
      data: { status },
    });

    this.realtime.emitToTenant(this.prisma.tenantId, 'message.status', {
      conversationId: updated.conversationId,
      messageId: updated.id,
      status: updated.status,
    });
  }

  async sendAgentMessage(
    conversationId: string,
    agentId: string,
    content: string,
    replyToId?: string,
  ) {
    await this.requireConversationExists(conversationId);
    const { message } = await this.persistMessage(conversationId, {
      senderType: 'AGENT',
      senderId: agentId,
      content,
      replyToId,
    });
    return message;
  }

  /**
   * Reação vinda do cliente. Fica gravada na mensagem reagida (não vira
   * mensagem nova) — emoji vazio significa "removeu a reação", que é como
   * a Meta representa desfazer.
   */
  async applyReaction(externalId: string, emoji: string, from: string) {
    const message = await this.prisma.db.message.findFirst({
      where: { externalId },
      select: { id: true, conversationId: true, reactions: true },
    });
    if (!message) return;

    const current =
      message.reactions && typeof message.reactions === 'object' && !Array.isArray(message.reactions)
        ? ({ ...message.reactions } as Record<string, string[]>)
        : {};

    // Uma pessoa tem no máximo uma reação por mensagem: tira das outras
    // antes de colocar na nova.
    for (const key of Object.keys(current)) {
      current[key] = (current[key] ?? []).filter((who) => who !== from);
      if (current[key].length === 0) delete current[key];
    }
    if (emoji) {
      current[emoji] = [...(current[emoji] ?? []), from];
    }

    const updated = await this.prisma.db.message.update({
      where: { id: message.id },
      data: { reactions: current as Prisma.InputJsonValue },
      include: messageInclude,
    });

    this.realtime.emitToTenant(this.prisma.tenantId, 'message.updated', {
      conversationId: message.conversationId,
      message: updated,
    });
  }

  /** Reação enviada por um atendente pelo painel. */
  async reactToMessage(conversationId: string, messageId: string, emoji: string) {
    const conversation = await this.prisma.db.conversation.findFirst({
      where: { id: conversationId },
      include: { customer: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada.');
    }

    const message = await this.prisma.db.message.findFirst({
      where: { id: messageId, conversationId },
      select: { externalId: true },
    });
    if (message?.externalId && conversation.channel === 'WHATSAPP') {
      await this.whatsapp.sendReaction(
        conversation.customer.phone,
        message.externalId,
        emoji,
      );
    }

    return this.applyReactionLocal(messageId, emoji, 'agent');
  }

  private async applyReactionLocal(messageId: string, emoji: string, who: string) {
    const message = await this.prisma.db.message.findFirst({
      where: { id: messageId },
      select: { id: true, conversationId: true, reactions: true },
    });
    if (!message) {
      throw new NotFoundException('Mensagem não encontrada.');
    }

    const current =
      message.reactions && typeof message.reactions === 'object' && !Array.isArray(message.reactions)
        ? ({ ...message.reactions } as Record<string, string[]>)
        : {};
    for (const key of Object.keys(current)) {
      current[key] = (current[key] ?? []).filter((entry) => entry !== who);
      if (current[key].length === 0) delete current[key];
    }
    if (emoji) current[emoji] = [...(current[emoji] ?? []), who];

    const updated = await this.prisma.db.message.update({
      where: { id: message.id },
      data: { reactions: current as Prisma.InputJsonValue },
      include: messageInclude,
    });

    this.realtime.emitToTenant(this.prisma.tenantId, 'message.updated', {
      conversationId: message.conversationId,
      message: updated,
    });
    return updated;
  }

  /**
   * Anexo enviado pelo painel: sobe pra Meta, manda pro cliente e grava no
   * histórico. O arquivo em si não fica no nosso banco — a Meta hospeda, e
   * guardamos o id dela, mesmo caminho da mídia que o cliente envia.
   */
  /**
   * Áudio gravado no navegador chega em webm/opus (padrão do Chrome), que a
   * Cloud API não aceita. Aqui ele vira ogg/opus antes de subir. Se a
   * máquina não tiver ffmpeg, o erro diz exatamente isso em vez de deixar a
   * Meta recusar com uma mensagem genérica.
   */
  private async prepareAudio<
    T extends { buffer: Buffer; mimetype: string; originalname: string },
  >(file: T): Promise<T> {
    if (!file.mimetype.startsWith('audio/') || isAcceptedAudio(file.mimetype)) {
      return file;
    }

    const converted = await remuxToOggOpus(file.buffer);
    if (!converted) {
      throw new BadRequestException(
        'Não deu pra converter o áudio pro formato que o WhatsApp aceita. ' +
          'Instale o ffmpeg no servidor da API pra habilitar o envio de áudio gravado.',
      );
    }

    return {
      ...file,
      buffer: converted,
      mimetype: 'audio/ogg',
      originalname: file.originalname.replace(/\.[^.]+$/, '') + '.ogg',
    };
  }

  async sendAttachment(
    conversationId: string,
    agentId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    caption?: string,
  ) {
    const conversation = await this.requireConversation(conversationId);

    if (conversation.channel !== 'WHATSAPP') {
      throw new BadRequestException(
        'Anexos só valem em conversas de WhatsApp.',
      );
    }

    const toUpload = await this.prepareAudio(file);

    const mediaId = await this.media.upload(toUpload);
    if (!mediaId) {
      throw new BadRequestException(
        'A Meta recusou o arquivo. Confira o formato e o tamanho.',
      );
    }

    const kind = mediaKindFor(toUpload.mimetype);
    const externalId = await this.whatsapp.sendMedia(
      conversation.customer.phone,
      kind,
      mediaId,
      { caption, filename: file.originalname },
    );

    const message = await this.prisma.db.message.create({
      data: {
        tenantId: this.prisma.tenantId,
        conversationId,
        senderType: 'AGENT',
        senderId: agentId,
        content: caption ?? file.originalname,
        messageType: MEDIA_MESSAGE_TYPE[kind],
        externalId,
        metadata: {
          mediaId,
          mimeType: file.mimetype,
          fileName: file.originalname,
          size: file.size,
        } as Prisma.InputJsonValue,
      },
    });

    const updated = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: message.createdAt,
        status: 'WAITING_CUSTOMER',
        unreadCount: 0,
      },
      include: conversationInclude,
    });

    this.realtime.emitToTenant(this.prisma.tenantId, 'message.created', {
      conversationId,
      message,
    });
    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(updated),
    );

    return message;
  }

  async assign(conversationId: string, userId: string) {
    await this.requireConversation(conversationId);

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: {
        assignedUserId: userId,
        aiMode: 'HUMAN_ACTIVE',
        status: 'WAITING_AGENT',
      },
      include: conversationInclude,
    });

    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(conversation),
    );
    return conversation;
  }

  /**
   * Resolver avisa o cliente por padrão: sem isso ele fica esperando uma
   * resposta que não vem, sem saber que o atendimento foi encerrado. O
   * aviso vai antes da troca de status pra a mensagem não ficar marcada
   * como "aguardando cliente" de uma conversa já resolvida.
   */
  async resolve(conversationId: string) {
    await this.requireConversationExists(conversationId);

    const settings = await this.inboxSettings.get();
    if (settings.notifyOnResolve && settings.resolveMessage.trim()) {
      await this.persistMessage(conversationId, {
        senderType: 'AGENT',
        content: settings.resolveMessage.trim(),
      });
    }

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: { status: 'RESOLVED' },
      include: conversationInclude,
    });

    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(conversation),
    );
    return conversation;
  }

  async setAiMode(conversationId: string, aiMode: AiMode) {
    await this.requireConversation(conversationId);

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: { aiMode },
      include: conversationInclude,
    });

    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(conversation),
    );
    return conversation;
  }

  /**
   * Recebe uma mensagem de cliente vinda de qualquer canal: encontra ou cria
   * o cliente pelo telefone, reaproveita uma conversa em aberto ou cria uma
   * nova, grava a mensagem — e, se a IA estiver ativa nessa conversa, deixa
   * ela responder antes de devolver. É o mesmo caminho que o webhook do
   * WhatsApp chama (ver WhatsappWebhookController) e que o simulador de
   * teste usa.
   */
  async receiveInbound(input: {
    customerPhone: string;
    customerName: string;
    content: string;
    channel?: ConversationChannel;
    messageType?: MessageType;
    metadata?: Prisma.InputJsonValue;
    externalId?: string;
    replyToExternalId?: string;
  }) {
    const customer = await this.customers.findOrCreateByPhone({
      phone: input.customerPhone,
      name: input.customerName,
    });

    let conversation = await this.prisma.db.conversation.findFirst({
      where: { customerId: customer.id, status: { in: OPEN_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });

    if (!conversation) {
      conversation = await this.prisma.db.conversation.create({
        data: {
          tenantId: this.prisma.tenantId,
          customerId: customer.id,
          channel: input.channel ?? 'INTERNAL',
        },
      });
    }

    // A citação chega como o wamid da mensagem original; traduzimos pro id
    // interno pra a tela conseguir montar a tarjinha sem consultar a Meta.
    const replyTo = input.replyToExternalId
      ? await this.prisma.db.message.findFirst({
          where: { externalId: input.replyToExternalId },
          select: { id: true },
        })
      : null;

    const inbound = await this.persistMessage(conversation.id, {
      senderType: 'CUSTOMER',
      content: input.content,
      messageType: input.messageType,
      metadata: input.metadata,
      externalId: input.externalId,
      replyToId: replyTo?.id,
    });

    let latestConversation = inbound.conversation;

    if (conversation.aiMode === 'AI_ACTIVE') {
      const reply = await this.aiEngine.generateReply(conversation.id);
      if (reply) {
        const aiTurn = await this.persistMessage(conversation.id, {
          senderType: 'AI',
          content: reply,
        });
        latestConversation = aiTurn.conversation;
      }
    }

    return { conversation: latestConversation, message: inbound.message };
  }
}
