import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AiMode,
  ConversationChannel,
  ConversationPriority,
  ConversationStatus,
  MessageSenderType,
  MessageStatus,
} from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { AiEngineService } from '../ai/ai-engine.service';
import { CustomersService } from '../customers/customers.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
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

const conversationInclude = {
  customer: true,
  assignedUser: { select: { id: true, name: true, email: true, avatar: true } },
  queue: { select: { id: true, key: true, name: true } },
} as const;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly customers: CustomersService,
    private readonly realtime: RealtimeGateway,
    private readonly aiEngine: AiEngineService,
    private readonly whatsapp: WhatsappSenderService,
  ) {}

  async list(filter: {
    status?: ConversationStatus;
    assignedUserId?: string;
    queueId?: string;
    customerId?: string;
    priority?: ConversationPriority;
    unreadOnly?: boolean;
    sort?: 'recent' | 'priority';
  }) {
    return this.prisma.db.conversation.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.assignedUserId
          ? { assignedUserId: filter.assignedUserId }
          : {}),
        ...(filter.queueId ? { queueId: filter.queueId } : {}),
        ...(filter.customerId ? { customerId: filter.customerId } : {}),
        ...(filter.priority ? { priority: filter.priority } : {}),
        ...(filter.unreadOnly ? { unreadCount: { gt: 0 } } : {}),
      },
      include: conversationInclude,
      // A ordenação por prioridade aproveita a ordem do enum no banco
      // (LOW < NORMAL < HIGH < URGENT), então desc põe urgente no topo e
      // usa a mensagem mais recente como desempate.
      orderBy:
        filter.sort === 'priority'
          ? [{ priority: 'desc' }, { lastMessageAt: 'desc' }]
          : { lastMessageAt: 'desc' },
    });
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
    const conversation = await this.requireConversation(id);
    if (conversation.unreadCount === 0) {
      return conversation;
    }

    const updated = await this.prisma.db.conversation.update({
      where: { id },
      data: { unreadCount: 0 },
      include: conversationInclude,
    });
    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      updated,
    );

    return { ...conversation, unreadCount: 0 };
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
      conversation,
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
    data: { senderType: MessageSenderType; senderId?: string; content: string },
  ) {
    const message = await this.prisma.db.message.create({
      data: { tenantId: this.prisma.tenantId, conversationId, ...data },
    });

    const fromCustomer = data.senderType === 'CUSTOMER';
    // Nota interna do sistema (ex: aviso de transferência de fila) não muda
    // de quem é a vez nem conta como mensagem a ler — antes ela empurrava a
    // conversa pra "aguardando cliente" mesmo tendo acabado de cair no colo
    // de um atendente.
    const isSystemNote = data.senderType === 'SYSTEM';
    const status: ConversationStatus | undefined = isSystemNote
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
      conversation,
    );

    // Só ecoa pro WhatsApp respostas da empresa (IA ou atendente) — mensagens
    // do próprio cliente óbvio não, e mensagens SYSTEM (ex: aviso de
    // transferência de fila) são notas internas pro time, não pro cliente.
    if (
      conversation.channel === 'WHATSAPP' &&
      (data.senderType === 'AI' || data.senderType === 'AGENT')
    ) {
      const externalId = await this.whatsapp.sendText(
        conversation.customer.phone,
        data.content,
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
  ) {
    await this.requireConversation(conversationId);
    const { message } = await this.persistMessage(conversationId, {
      senderType: 'AGENT',
      senderId: agentId,
      content,
    });
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
      conversation,
    );
    return conversation;
  }

  async resolve(conversationId: string) {
    await this.requireConversation(conversationId);

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: { status: 'RESOLVED' },
      include: conversationInclude,
    });

    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      conversation,
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
      conversation,
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

    const inbound = await this.persistMessage(conversation.id, {
      senderType: 'CUSTOMER',
      content: input.content,
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
