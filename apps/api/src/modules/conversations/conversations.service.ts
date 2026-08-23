import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
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
  UserRole,
} from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { AiEngineService } from '../ai/ai-engine.service';
import { TranscricaoService } from '../ai/transcricao.service';
import { AuditService } from '../audit/audit.service';
import { PushService } from '../push/push.service';
import type { VerificacaoDaResposta } from '../ai/ai-guardrails';
import { CollectionService } from '../collection/collection.service';
import { CustomersService } from '../customers/customers.service';
import { InboxSettingsService } from '../inbox-settings/inbox-settings.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RoutingService } from '../routing/routing.service';
import { TagsService } from '../tags/tags.service';
import {
  converterParaOggOpus,
  jaEhOggOpus,
} from '../whatsapp/audio-container';
import { WhatsappMediaService } from '../whatsapp/whatsapp-media.service';
import { CanalService } from '../whatsapp/canal/canal.service';
import { idDaMensagem } from '../whatsapp/canal/evolution/evolution-id';
import { AVISO_DE_INDISPONIBILIDADE } from '../ai/ai-indisponivel';

/**
 * Os três estados que importam pra quem atende, montados a partir dos cinco
 * status internos.
 *
 * A lista de status crua ("Abertas", "Aguard. atendente", "Aguard.
 * cliente", "Resolvidas", "Fechadas") descreve a máquina de estados, não o
 * trabalho. Quem abre o painel de manhã pergunta outra coisa: o que é minha
 * vez de responder, o que está esperando o cliente, e o que já acabou.
 *
 * PENDING junta OPEN e WAITING_AGENT porque nos dois a bola está com a
 * empresa. DONE junta RESOLVED e CLOSED porque a diferença entre os dois
 * não muda nada pra quem está escolhendo o que fazer agora.
 */
/**
 * "Pendente" é tudo que ainda não foi encerrado — inclusive o que está
 * aguardando o cliente.
 *
 * A versão anterior tirava "aguardando cliente" de Pendentes, e o efeito
 * era uma conversa viva sumir da tela onde se trabalha: quem só olha
 * Pendentes deixava de ver um atendimento em aberto porque a última fala
 * tinha sido da empresa. O único critério pra sair daqui é ter terminado.
 *
 * "Aguardando" continua existindo como recorte de quem quer ver só o que
 * está na mão do cliente — agora um subconjunto de Pendentes, não um
 * compartimento à parte.
 */
export const STATUS_GROUPS = {
  PENDING: ['OPEN', 'WAITING_AGENT', 'WAITING_CUSTOMER'],
  WAITING: ['WAITING_CUSTOMER'],
  DONE: ['RESOLVED', 'CLOSED'],
} as const satisfies Record<string, readonly ConversationStatus[]>;

export type StatusGroup = keyof typeof STATUS_GROUPS;

/**
 * O recorte que a pessoa escolheu na barra do Inbox.
 *
 * O MESMO objeto alimenta a lista e os contadores — e isso é o ponto. Com
 * dois filtros escritos em lugares separados, os números do cabeçalho
 * passam a discordar da lista embaixo: "12 pendentes" com cinco conversas
 * na tela. Quem trabalha ali não tem como saber se as outras sete são de
 * outro setor ou se a página parou de carregar, e a dúvida contamina a
 * confiança na tela inteira.
 */
/**
 * Como a lista é ordenada.
 *
 * RECENTE é o padrão e a leitura de mensageiro: quem falou por último em
 * cima, que é o que a memória muscular espera.
 *
 * ESPERA é a fila de atendimento: quem está esperando resposta há mais
 * tempo primeiro. Existe porque as duas ordens discordam justamente onde
 * dói — o cliente que escreveu de manhã e não insistiu mais afunda na
 * ordem por recência, e é ele que está sem atendimento há mais tempo.
 */
export type OrdemDoInbox = 'RECENTE' | 'ESPERA';

export interface FiltroDoInbox {
  status?: ConversationStatus;
  /** Grupo de trabalho (ver STATUS_GROUPS). Ignorado se `status` vier. */
  statusGroup?: StatusGroup;
  assignedUserId?: string;
  queueId?: string;
  customerId?: string;
  priority?: ConversationPriority;
  unreadOnly?: boolean;
  unassignedOnly?: boolean;
  search?: string;
  ordem?: OrdemDoInbox;
  /** Só as que estão esperando resposta da empresa. */
  waitingOnly?: boolean;
  /** Só o que a IA está conduzindo agora. */
  comIa?: boolean;
  /**
   * Só as conversas com ESTA etiqueta.
   *
   * Uma, e não várias: "orçamento E reclamação" é uma pergunta que quase
   * ninguém faz, e a barra que deixasse combinar etiquetas viraria o
   * formulário que o Inbox passou o tempo todo evitando.
   */
  tagId?: string;
  /**
   * Mostrar GRUPOS em vez de conversas de cliente.
   *
   * É um eixo à parte, e não mais uma faceta: as duas listas nunca se
   * misturam. Um grupo movimentado produz dezenas de mensagens por dia e
   * ficaria no topo o tempo todo, empurrando pra baixo o cliente que está
   * esperando — que é exatamente o que a caixa existe pra evitar.
   *
   * Por ser eixo, ele não entra na conta das facetas (ver `onde`): os
   * números das abas de situação valem DENTRO do que está sendo mostrado.
   */
  grupos?: boolean;
  /** Quem está olhando — define o que ela pode enxergar. */
  viewer?: { userId: string; role: UserRole };
}

/**
 * As facetas da barra, na forma que o contador entende.
 *
 * Um contador responde sempre a mesma pergunta: "se eu ligar ISTO, mantendo
 * o resto como está, quantas vou ver?". Pra responder, ele monta o filtro
 * atual SEM a própria faceta — senão "Minhas" contaria só o que já está
 * filtrado por "Minhas", e o número seria o tamanho da lista, não uma
 * informação nova.
 */
type Faceta =
  | 'situacao'
  | 'priority'
  | 'mine'
  | 'unread'
  | 'unassigned'
  | 'waiting'
  | 'comIa';

const OPEN_STATUSES: ConversationStatus[] = [
  'OPEN',
  'WAITING_CUSTOMER',
  'WAITING_AGENT',
];

/**
 * O banco recusou porque esta mensagem JÁ está gravada.
 *
 * `P2002` é a violação de índice único — aqui, sempre o de
 * `(tenantId, externalId)`. Ele acontece quando duas entregas da mesma
 * mensagem correm juntas: as duas conferem "já tenho?", as duas leem que
 * não, e a segunda a gravar esbarra no índice.
 *
 * Não é erro de ninguém, e principalmente não é um 500: devolver erro faz
 * a Evolution reenviar, e reenviar é como o problema começou. Quem chama
 * trata como o que é — a mesma entrega, de novo.
 */
function entregaRepetida(erro: unknown): boolean {
  return (
    typeof erro === 'object' &&
    erro !== null &&
    (erro as { code?: unknown }).code === 'P2002'
  );
}

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
export function mediaKindFor(
  mimeType: string,
): 'image' | 'document' | 'audio' | 'video' | 'sticker' {
  // webp é o formato de figurinha do WhatsApp. Mandado como imagem ele
  // chega no aparelho como uma foto quadrada com fundo branco; como
  // sticker chega como figurinha de verdade, transparência e tudo.
  if (mimeType.startsWith('image/webp')) return 'sticker';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

const MEDIA_MESSAGE_TYPE: Record<
  'image' | 'document' | 'audio' | 'video' | 'sticker',
  MessageType
> = {
  image: 'IMAGE',
  document: 'DOCUMENT',
  audio: 'AUDIO',
  video: 'VIDEO',
  // Figurinha é imagem pro histórico: o painel desenha do mesmo jeito, e
  // criar um tipo novo obrigaria migração de banco por causa de moldura.
  sticker: 'IMAGE',
};

/**
 * Uma linha que descreve a mensagem no corpo da notificação.
 *
 * Anexo chega com `content` vazio, e um aviso sem texto no celular parece
 * defeito do sistema. Os rótulos são os mesmos que o painel usa na prévia
 * da lista de conversas — ver `resumoDaMensagem`, no lado do navegador.
 */
function resumoParaAviso(content: string, messageType: MessageType): string {
  if (messageType === 'TEXT') return content;

  const rotulo = RESUMO_DE_MIDIA[messageType] ?? 'Anexo';
  const legenda = content.trim();
  return legenda ? `${rotulo} · ${legenda}` : rotulo;
}

const RESUMO_DE_MIDIA: Partial<Record<MessageType, string>> = {
  IMAGE: 'Imagem',
  AUDIO: 'Áudio',
  VIDEO: 'Vídeo',
  DOCUMENT: 'Documento',
  LOCATION: 'Localização',
};

/**
 * Quantas pessoas a empresa pode abordar primeiro por dia.
 *
 * Trinta é conservador de propósito. Não existe número publicado pelo
 * WhatsApp — a detecção não é documentada, e quem promete um limite
 * "seguro" está chutando. O que se sabe é a direção: quanto mais gente
 * nova por dia, maior o risco, e o salto perigoso é de dezenas pra
 * centenas.
 *
 * Trinta cobre com folga o uso legítimo (retomar um orçamento, avisar que
 * o pedido chegou) e impede que a tela vire ferramenta de prospecção.
 */
const TETO_DE_ABORDAGENS_POR_DIA = 30;

const conversationInclude = {
  customer: true,
  assignedUser: { select: { id: true, name: true, email: true, avatar: true } },
  queue: { select: { id: true, key: true, name: true } },
  // As etiquetas vêm em toda leitura de conversa: elas aparecem na LISTA,
  // que é onde servem — saber do que se trata antes de abrir. Buscá-las só
  // no detalhe faria a lista mostrar conversa sem etiqueta e a etiqueta
  // aparecer depois do clique, que é o oposto do ponto.
  tags: {
    select: { tag: { select: { id: true, name: true, color: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
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
/**
 * Tira o id da mídia de dentro do metadata pra gravar na coluna própria.
 *
 * A coluna é espelho, não substituta: o metadata continua carregando mime,
 * nome do arquivo e chave do bucket, e é de lá que este valor sai. Ter o
 * espelho num único lugar evita o defeito silencioso de um caminho de
 * criação preencher a coluna e outro não — o anexo gravado pelo caminho
 * esquecido simplesmente não abriria.
 */
export function mediaIdDe(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }
  const valor = (metadata as { mediaId?: unknown }).mediaId;
  return typeof valor === 'string' && valor ? valor : undefined;
}

function toSummary<
  T extends { messages: unknown[]; tags?: { tag: unknown }[] },
>(conversation: T) {
  const { messages, tags, ...rest } = conversation;
  return {
    ...rest,
    // A ligação é detalhe do banco; quem desenha quer a etiqueta.
    tags: (tags ?? []).map((ligacao) => ligacao.tag),
    lastMessage: messages[0] ?? null,
  };
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
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly customers: CustomersService,
    private readonly realtime: RealtimeGateway,
    private readonly aiEngine: AiEngineService,
    private readonly whatsapp: CanalService,
    private readonly media: WhatsappMediaService,
    private readonly inboxSettings: InboxSettingsService,
    private readonly routing: RoutingService,
    private readonly collection: CollectionService,
    private readonly tags: TagsService,
    private readonly transcricao: TranscricaoService,
    private readonly audit: AuditService,
    private readonly push: PushService,
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
  async list(filter: FiltroDoInbox & { cursor?: string; limit?: number }) {
    const take = Math.min(Math.max(filter.limit ?? 30, 1), 100);
    const recorte = await this.recorteDeVisibilidade(filter.viewer);

    const items = await this.prisma.db.conversation.findMany({
      where: this.montarWhere(filter, recorte),
      include: conversationInclude,
      // Na fila, quem espera há MAIS tempo primeiro; `nulls: 'last'` joga
      // pro fim quem não está esperando ninguém — sem isso o Postgres põe
      // os nulos na frente e a fila abre com quem já foi respondido.
      orderBy:
        filter.ordem === 'ESPERA'
          ? [{ waitingSince: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]
          : [{ lastMessageAt: 'desc' }, { id: 'desc' }],
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

  /**
   * Traduz o recorte da barra num `where` do Prisma.
   *
   * `exceto` é o que faz os contadores serem úteis: pra saber quantas
   * conversas "Minhas" existem dentro do que já está filtrado, o filtro é
   * montado sem a própria opção "Minhas".
   *
   * `situacao` cobre grupo e status exato juntos porque são o MESMO eixo —
   * "Pendentes" e "Aguard. cliente" respondem a mesma pergunta em duas
   * granularidades. Separá-los deixaria contar um recorte impossível
   * (grupo Resolvidas com status Aberta), e nenhum número desses ajudaria
   * ninguém.
   */
  private montarWhere(
    filtro: FiltroDoInbox,
    recorte: Prisma.ConversationWhereInput,
    exceto: Faceta[] = [],
  ): Prisma.ConversationWhereInput {
    const fora = new Set(exceto);
    const search = filtro.search?.trim();

    /**
     * "Pendente" quer dizer "precisa de uma pessoa".
     *
     * Conversa que a IA está conduzindo não está esperando ninguém da
     * equipe: ela já foi respondida e segue em andamento. Deixá-la na mesma
     * lista fazia o atendente abrir uma por uma pra descobrir que não havia
     * nada a fazer — e, num dia movimentado, era o suficiente pra enterrar
     * a conversa que realmente precisava dele.
     *
     * Ligar "Com a IA" pede exatamente o contrário, então ele MANDA na
     * exclusão: sem isso, "Pendentes + Com a IA" seria vazio sempre, um
     * recorte impossível de dois botões que a tela deixa clicar juntos.
     */
    const comIa = !fora.has('comIa') && filtro.comIa === true;
    const soDeGente =
      !fora.has('comIa') &&
      !fora.has('situacao') &&
      !filtro.status &&
      filtro.statusGroup === 'PENDING';

    return {
      ...recorte,
      // Grupo e cliente nunca aparecem na mesma lista. Fora de qualquer
      // faceta de propósito: é o recorte que define QUAL caixa está
      // aberta, e os contadores das abas contam dentro dela.
      customer: { isGroup: filtro.grupos === true },
      // Status exato ganha do grupo: se alguém pediu "só as fechadas",
      // não faz sentido devolver também as resolvidas.
      ...(fora.has('situacao')
        ? {}
        : filtro.status
          ? { status: filtro.status }
          : filtro.statusGroup
            ? { status: { in: [...STATUS_GROUPS[filtro.statusGroup]] } }
            : {}),
      ...(comIa
        ? { aiMode: 'AI_ACTIVE' as const }
        : soDeGente
          ? { aiMode: { not: 'AI_ACTIVE' as const } }
          : {}),
      ...(filtro.assignedUserId && !fora.has('mine')
        ? { assignedUserId: filtro.assignedUserId }
        : {}),
      ...(filtro.queueId ? { queueId: filtro.queueId } : {}),
      // A etiqueta não é faceta contável: ela é outro eixo, e não concorre
      // com situação/prioridade/espera pelo mesmo espaço da barra.
      ...(filtro.tagId ? { tags: { some: { tagId: filtro.tagId } } } : {}),
      ...(filtro.customerId ? { customerId: filtro.customerId } : {}),
      ...(filtro.priority && !fora.has('priority')
        ? { priority: filtro.priority }
        : {}),
      ...(filtro.unreadOnly && !fora.has('unread')
        ? { unreadCount: { gt: 0 } }
        : {}),
      ...(filtro.unassignedOnly && !fora.has('unassigned')
        ? { assignedUserId: null }
        : {}),
      ...(filtro.waitingOnly && !fora.has('waiting')
        ? { waitingSince: { not: null } }
        : {}),
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
    };
  }

  /**
   * Filtro extra de "o que esta pessoa pode ver" no Inbox.
   *
   * Com `queueVisibility: ALL` (padrão) não recorta nada — equipe pequena
   * trabalha melhor vendo tudo. Com `OWN_QUEUES`, cada um vê só os setores
   * de que participa: o financeiro não abre conversa do jurídico.
   *
   * Três coisas ficam sempre visíveis, mesmo no modo restrito, porque
   * escondê-las criaria buraco em vez de organização:
   *
   * - conversa atribuída à própria pessoa (senão ela perde de vista um caso
   *   que é dela, se o setor mudar);
   * - conversa sem setor nenhum (não é de ninguém — se sumisse pra todo
   *   mundo, ficaria sem atendimento);
   * - tudo, pra dono e admin: sem isso não dá pra chefiar.
   */
  private async recorteDeVisibilidade(viewer?: { userId: string; role: UserRole }) {
    if (!viewer || viewer.role === 'OWNER' || viewer.role === 'ADMIN') return {};

    const settings = await this.inboxSettings.get();
    if (settings.queueVisibility === 'ALL') return {};

    const setores = await this.prisma.db.queueMember.findMany({
      where: { userId: viewer.userId },
      select: { queueId: true },
    });

    return {
      OR: [
        { queueId: null },
        { queueId: { in: setores.map((s) => s.queueId) } },
        { assignedUserId: viewer.userId },
      ],
    } satisfies Prisma.ConversationWhereInput;
  }

  /**
   * Contadores da barra de filtros.
   *
   * Duas regras, e as duas vieram de a tela se contradizer na frente de
   * quem usa:
   *
   * 1. Passam pelo MESMO recorte de visibilidade da lista. Sem isso, quem
   *    trabalha no modo restrito via "12 pendentes" no cabeçalho e cinco
   *    conversas embaixo.
   *
   * 2. Cada número já considera os OUTROS filtros ligados. Filtrar por
   *    Pendentes e ver "Minhas 5" quando a lista mostra uma só é a mesma
   *    contradição de outra forma — o contador estava respondendo sobre a
   *    empresa inteira enquanto a lista respondia sobre o recorte.
   *
   * O que cada um responde agora: "se eu ligar isto, mantendo o resto,
   * quantas vou ver?". Por isso a própria faceta sai do filtro antes de
   * contar (ver `montarWhere`).
   */
  async counts(filtro: FiltroDoInbox & { viewer: { userId: string; role: UserRole } }) {
    const recorte = await this.recorteDeVisibilidade(filtro.viewer);
    const onde = (exceto: Faceta[], extra: Prisma.ConversationWhereInput = {}) => ({
      where: { ...this.montarWhere(filtro, recorte, exceto), ...extra },
    });

    // Os quatro botões de situação são um eixo só: contar cada um exige
    // tirar a situação atual do filtro, senão "Resolvidas" contaria dentro
    // de "Pendentes" e daria zero sempre.
    const semSituacao = (extra: Prisma.ConversationWhereInput = {}) =>
      onde(['situacao'], extra);

    const [
      total,
      unread,
      mine,
      unassigned,
      esperando,
      pendentes,
      aguardando,
      resolvidas,
      comIa,
      byStatus,
      byPriority,
    ] = await Promise.all([
      this.prisma.db.conversation.count(semSituacao()),
      this.prisma.db.conversation.count(onde(['unread'], { unreadCount: { gt: 0 } })),
      this.prisma.db.conversation.count(
        onde(['mine'], { assignedUserId: filtro.viewer.userId }),
      ),
      this.prisma.db.conversation.count(
        onde(['unassigned'], { assignedUserId: null }),
      ),
      this.prisma.db.conversation.count(
        onde(['waiting'], { waitingSince: { not: null } }),
      ),
      // Os três grupos de trabalho (ver STATUS_GROUPS): é a pergunta que
      // quem atende faz de manhã - o que é minha vez, o que está com o
      // cliente, o que já acabou.
      //
      // Pendentes repete aqui a exclusão da IA que `montarWhere` aplica na
      // lista: tirar a situação do filtro tira junto a regra que depende
      // dela, e um contador que não bate com a lista embaixo é pior que
      // contador nenhum.
      this.prisma.db.conversation.count(
        semSituacao({
          status: { in: [...STATUS_GROUPS.PENDING] },
          ...(filtro.comIa ? {} : { aiMode: { not: 'AI_ACTIVE' as const } }),
        }),
      ),
      this.prisma.db.conversation.count(
        semSituacao({ status: { in: [...STATUS_GROUPS.WAITING] } }),
      ),
      this.prisma.db.conversation.count(
        semSituacao({ status: { in: [...STATUS_GROUPS.DONE] } }),
      ),
      this.prisma.db.conversation.count(
        onde(['comIa'], { aiMode: 'AI_ACTIVE' }),
      ),
      this.prisma.db.conversation.groupBy({
        by: ['status'],
        _count: { _all: true },
        ...semSituacao(),
      }),
      this.prisma.db.conversation.groupBy({
        by: ['priority'],
        _count: { _all: true },
        ...onde(['priority']),
      }),
    ]);

    return {
      total,
      unread,
      comIa,
      mine,
      unassigned,
      esperando,
      pendentes,
      aguardando,
      resolvidas,
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

    const comNome = await this.comNomeDeQuemEnviou([...page].reverse());

    return {
      items: comNome.map((mensagem) => this.esconderApagada(mensagem)),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * Tira o conteúdo de uma mensagem apagada antes de ela sair da API.
   *
   * O banco guarda o texto original (ver `apagarMensagem`); é aqui que ele
   * para de trafegar. Fazer isso na saída, e não no banco, é o que permite
   * apagar sem destruir: a prova continua existindo pra quem tiver acesso
   * ao banco, e o painel — que é o que a equipe e uma tela compartilhada
   * mostram — não exibe mais nada.
   */
  private esconderApagada<
    T extends {
      deletedAt: Date | null;
      content: string;
      metadata: Prisma.JsonValue | null;
    },
  >(mensagem: T): T {
    if (!mensagem.deletedAt) return mensagem;
    return {
      ...mensagem,
      content: '',
      // Sem metadata não há mediaId, e sem mediaId o anexo não pode ser
      // baixado pelo proxy. Apagar precisa valer pro arquivo também.
      metadata: null,
      replyTo: null,
    };
  }

  /**
   * Acrescenta `senderName` nas mensagens de atendente.
   *
   * Numa conversa que passou por três pessoas, o balão verde sozinho não
   * conta a história: quem lê depois não sabe quem prometeu o quê. O nome
   * resolve isso dentro do painel, independente da empresa querer ou não
   * assinar a mensagem que vai pro cliente (ver `assinar`).
   *
   * Resolve os nomes numa consulta só, e não por relação no schema, porque
   * `senderId` guarda tanto id de usuário quanto nada (mensagem da IA, do
   * cliente, do sistema) — uma chave estrangeira ali obrigaria a coluna a
   * ser sempre um usuário válido, que é justamente o que ela não é.
   */
  private async comNomeDeQuemEnviou<T extends { senderType: string; senderId: string | null }>(
    mensagens: T[],
  ): Promise<(T & { senderName: string | null })[]> {
    const ids = [
      ...new Set(
        mensagens
          .filter((m) => m.senderType === 'AGENT' && m.senderId)
          .map((m) => m.senderId as string),
      ),
    ];
    if (ids.length === 0) {
      return mensagens.map((m) => ({ ...m, senderName: null }));
    }

    const pessoas = await this.prisma.db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const porId = new Map(pessoas.map((p) => [p.id, p.name]));

    return mensagens.map((m) => ({
      ...m,
      senderName: m.senderId ? (porId.get(m.senderId) ?? null) : null,
    }));
  }

  /**
   * Anuncia uma mensagem nova pro painel, sempre com `senderName`.
   *
   * Existe pra os caminhos que não passam por `persistMessage` (anexo,
   * encaminhamento, início por template) não emitirem um balão anônimo: a
   * mensagem chegava sem assinatura e só ganhava o nome de quem respondeu
   * quando alguém recarregava a conversa.
   */
  private async emitirMensagemCriada(
    conversationId: string,
    mensagem: { senderType: string; senderId: string | null },
  ) {
    const [comNome] = await this.comNomeDeQuemEnviou([mensagem]);
    this.realtime.emitToTenant(this.prisma.tenantId, 'message.created', {
      conversationId,
      message: comNome,
    });
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

  /**
   * A conversa, pra quem só precisa saber que ela existe.
   *
   * Sem as mensagens, e isso é o ponto. Ela carregava o histórico INTEIRO,
   * sem limite, em toda mudança de prioridade, atribuição, etiqueta e
   * transferência — e nenhum desses chamadores lê uma linha do que vinha.
   * Enquanto as conversas tinham dezenas de mensagens, era desperdício
   * invisível; com o histórico do aparelho importado, uma conversa de anos
   * faz cada uma dessas operações arrastar milhares de linhas do banco
   * pra jogar fora.
   *
   * Quem precisa das mensagens usa `getById`, que já pagina — e é a
   * paginação que a tela consome ao rolar pra cima.
   */
  private async requireConversation(id: string) {
    const conversation = await this.prisma.db.conversation.findFirst({
      where: { id },
      include: conversationInclude,
    });
    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada.');
    }
    return conversation;
  }

  /**
   * Abre a conversa SEM marcar como lida.
   *
   * Antes, abrir zerava o contador. Isso confundia duas coisas diferentes:
   * clicar na conversa e ler a mensagem. Quem clica numa conversa de
   * duzentas mensagens e fica no meio do histórico não leu o que chegou
   * agora — e a mensagem já contava como vista, sem tique azul devido pro
   * cliente e sem o marcador de "não lidas" que diz onde parar de rolar.
   *
   * Quem marca como lida é `marcarComoLida`, chamada pela tela quando o fim
   * da conversa aparece de verdade na área visível. O contador vem intacto
   * daqui justamente pra ela conseguir desenhar o marcador antes disso.
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

    return {
      ...conversation,
      messages: messages.items,
      messagesCursor: messages.nextCursor,
    };
  }

  /**
   * O fim da conversa apareceu na tela de alguém: agora sim foi lida.
   *
   * Idempotente e barata quando não há o que fazer — a tela chama isto a
   * cada rolagem que chega no fim, e o caso comum é o contador já estar
   * zerado.
   */
  async marcarComoLida(id: string) {
    const conversation = await this.prisma.db.conversation.findFirst({
      where: { id },
      select: { unreadCount: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada.');
    }
    if (conversation.unreadCount === 0) return { ok: true };

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
    // Avisa a Meta que a empresa leu — só se a empresa quiser revelar isso
    // (ver InboxSettings.sendReadReceipts). Agora o tique azul do cliente
    // corresponde a alguém ter mesmo olhado a mensagem.
    void this.markConversationRead(id);

    return { ok: true };
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
      await this.whatsapp.marcarComoLida(lastInbound.externalId);
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
      /** Só pra mensagem que já saiu por fora (eco do celular). */
      status?: MessageStatus;
      /**
       * A mensagem JÁ chegou no cliente por outro caminho — não reenviar.
       *
       * Existe por causa do eco da coexistência: o que a empresa digita no
       * celular volta pra cá pelo webhook como mensagem de atendente. Sem
       * esta trava, gravar o eco disparava um envio novo pro mesmo cliente:
       * ele recebia tudo duas vezes, e o externalId da Meta era
       * sobrescrito pelo do reenvio — o que estragava a idempotência e
       * fazia cada reentrega do webhook duplicar de novo.
       */
      jaEntregue?: boolean;
      /**
       * Quando a mensagem foi ESCRITA, quando isso não é agora.
       *
       * A conexão por aparelho vinculado entrega tudo o que chegou
       * enquanto a sessão estava fora no instante em que ela volta. Sem
       * isto, uma conversa parada desde as 9h apareceria inteira com a
       * hora da reconexão — e o alarme de espera mostraria zero minuto
       * pra quem esperou a manhã toda.
       */
      createdAt?: Date;
      /**
       * Saiu sozinha, em nome da empresa — e ninguém atendeu ainda.
       *
       * A saudação automática precisa de duas coisas que não vinham
       * juntas em nenhum tipo existente: ela É enviada ao cliente (o
       * SYSTEM não é, ele só aparece no painel) e NÃO pode dizer que a
       * bola está com o cliente (o AGENT diz, e mandaria a conversa pra
       * "aguardando cliente" um segundo depois de a pessoa escrever —
       * fora da fila de quem precisa de resposta, que é onde ela tem que
       * estar).
       *
       * Pelo mesmo motivo ela não zera o contador de não lidas: a
       * mensagem do cliente continua por ler pela equipe.
       */
      automatica?: boolean;
      /**
       * A conversa é um GRUPO.
       *
       * Tira a mensagem da fila de atendimento: grupo não cobra resposta,
       * e contar cada mensagem dele como "cliente esperando" transformaria
       * o contador de Pendentes e o alarme de espera em ruído.
       */
      grupo?: boolean;
    },
  ) {
    // `automatica` sai do espalhamento junto com `jaEntregue`: são
    // decisões de fluxo, não colunas da tabela de mensagens.
    const { jaEntregue = false, automatica = false, grupo = false, ...dadosDaMensagem } = data;
    const before = await this.prisma.db.conversation.findFirst({
      where: { id: conversationId },
      select: { status: true, aiMode: true, waitingSince: true },
    });

    const message = await this.prisma.db.message.create({
      data: {
        tenantId: this.prisma.tenantId,
        conversationId,
        ...dadosDaMensagem,
        mediaId: mediaIdDe(data.metadata),
      },
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

    /*
     * GRUPO não entra na fila de atendimento.
     *
     * Um grupo ativo produz dezenas de mensagens por dia, e cada uma delas
     * marcaria a conversa como "aberta, esperando a empresa". O efeito não
     * é cosmético: o contador de Pendentes vira ficção, e o alarme de
     * espera passa a gritar por uma conversa que ninguém precisa responder
     * — enterrando o cliente de verdade que está esperando embaixo.
     *
     * O grupo continua subindo na lista pela hora da última mensagem, que
     * é como se acompanha um grupo. O que ele não faz é cobrar resposta.
     */
    const status: ConversationStatus | undefined =
      isSystemNote || alreadyHandedOff || automatica || grupo
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
          : isSystemNote || automatica
            ? {}
            : { unreadCount: 0 }),
        /**
         * O relógio da espera.
         *
         * Começa a contar na PRIMEIRA mensagem sem resposta e não é
         * reiniciado pelas seguintes: quem escreveu às 9h e cobrou às 11h
         * espera desde as 9h, não desde as 11h. Reiniciar seria premiar
         * quem insiste — exatamente o que a ordem por recência já fazia.
         *
         * Zera quando a empresa responde, por gente ou pela IA. Nota do
         * sistema não conta: transferir de setor não é responder ao
         * cliente, e deixar que zerasse esconderia a espera bem no
         * momento em que ela mais importa.
         */
        ...(grupo
          ? {}
          : fromCustomer
            ? before?.waitingSince
              ? {}
              : { waitingSince: message.createdAt }
            : isSystemNote
              ? {}
              : { waitingSince: null }),
      },
      include: conversationInclude,
    });

    // O nome de quem enviou vai junto no evento também: sem isso a mensagem
    // que chega em tempo real apareceria sem assinatura e só ganharia o nome
    // quando a conversa fosse recarregada.
    const [comNome] = await this.comNomeDeQuemEnviou([message]);

    /*
     * A conversa vai ANTES da mensagem, e a ordem tem consequência.
     *
     * O painel guarda o nome do cliente de cada conversa ao receber
     * `conversation.updated`, e usa esse nome como TÍTULO da notificação do
     * navegador ao receber `message.created`. Emitindo a mensagem primeiro,
     * a primeira mensagem de um cliente novo chegava antes de existir nome
     * guardado — e a notificação que mais importa, a de quem escreve pela
     * primeira vez, era a única a sair como "Nova mensagem".
     *
     * Inverter é seguro porque o resumo já sai daqui com o `unreadCount`
     * incrementado (o update acima): o painel só zera o contador local
     * quando ele chega em zero, o que não é o caso de uma mensagem de
     * cliente entrando.
     */
    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(conversation),
    );
    this.realtime.emitToTenant(this.prisma.tenantId, 'message.created', {
      conversationId,
      message: comNome,
    });

    /*
     * O aviso que chega mesmo com o painel fechado.
     *
     * O tempo real acima só alcança quem está com a aba aberta. Este
     * caminho alcança o aparelho — é ele que faz o celular do dono tocar
     * às 20h, quando ninguém está olhando o computador.
     *
     * Sem `await` e com o erro engolido de propósito: isto roda dentro do
     * webhook da Evolution, que reenvia a entrega quando a resposta
     * demora. Esperar o serviço de push do Google pra confirmar uma
     * mensagem que já está gravada seria trocar confiabilidade por um
     * aviso.
     *
     * Só mensagem de CLIENTE: o que a própria empresa manda não precisa
     * ser anunciado de volta pra ela.
     */
    if (fromCustomer && !isSystemNote) {
      void this.push
        .avisarEquipe(this.prisma.tenantId, {
          titulo: conversation.customer?.name || 'Nova mensagem',
          corpo: resumoParaAviso(message.content, message.messageType),
          conversationId,
        })
        .catch(() => undefined);
    }

    // Só ecoa pro WhatsApp respostas da empresa (IA ou atendente) — mensagens
    // do próprio cliente óbvio não, e mensagens SYSTEM (ex: aviso de
    // transferência de fila) são notas internas pro time, não pro cliente.
    if (
      conversation.channel === 'WHATSAPP' &&
      !jaEntregue &&
      (data.senderType === 'AI' || data.senderType === 'AGENT')
    ) {
      const quoted = data.replyToId
        ? await this.prisma.db.message.findFirst({
            where: { id: data.replyToId },
            select: { externalId: true },
          })
        : null;

      const externalId = await this.whatsapp.enviarTexto(
        conversation.customer.phone,
        await this.assinar(data.senderType, data.senderId, data.content),
        quoted?.externalId,
      );

      /*
       * Sem id da Meta, a mensagem NÃO saiu — e isso precisa aparecer.
       *
       * O caminho de anexo já marcava a falha; o de texto ficava calado. O
       * resultado era o pior tipo de defeito: o WhatsApp desconectado, o
       * envio falhando, e o balão aparecendo com o mesmo tique de sempre.
       * Quem atendeu achava que o cliente tinha recebido, e o único lugar
       * que sabia da verdade era o log do servidor — que quem atende não
       * abre.
       *
       * O status vira FAILED (é o que acende o triângulo vermelho no
       * balão) e o motivo vai no metadata, junto da mensagem: "o WhatsApp
       * não está conectado nesta empresa" é acionável; um aviso no Railway
       * não é.
       */
      const falha = externalId
        ? null
        : (this.whatsapp.motivoDaUltimaFalha ?? 'a Meta recusou o envio');

      const gravada = await this.prisma.db.message.update({
        where: { id: message.id },
        data: {
          ...(externalId ? { externalId } : { status: 'FAILED' as const }),
          ...(falha
            ? {
                metadata: {
                  ...(typeof data.metadata === 'object' && data.metadata
                    ? (data.metadata as Record<string, unknown>)
                    : {}),
                  falha,
                } as Prisma.InputJsonValue,
              }
            : {}),
        },
        include: messageInclude,
      });

      if (falha) {
        // A tela precisa saber AGORA. Sem este aviso o triângulo só
        // apareceria na próxima vez que a conversa fosse aberta.
        await this.emitirMensagemCriada(conversationId, gravada);
      }

      /*
       * E quem chamou recebe a versão ATUALIZADA, não a de antes.
       *
       * Este `return` devolvia o objeto criado no início — o de antes de
       * saber se a mensagem saiu. Com o WhatsApp desconectado, a API
       * respondia "enviada" ao painel enquanto gravava "falhou" no banco.
       *
       * O balão nascia com o tique de sempre e só contava a verdade depois
       * de recarregar a página, que foi exatamente o relato. O aviso de
       * tempo real acima corrigia a tela às vezes: quando ele chegava
       * DEPOIS da resposta HTTP, o painel substituía a versão certa pela
       * errada de volta.
       */
      return { message: gravada, conversation };
    }

    return { message, conversation };
  }

  /**
   * Assina a mensagem com o nome de quem respondeu, se a empresa quiser.
   *
   * Vai só pro que sai daqui — o texto guardado no banco fica limpo, porque
   * no painel o nome já aparece no balão. Guardar a assinatura junto do
   * conteúdo faria a busca dentro da conversa casar com nome de atendente e
   * sujaria o histórico com prefixo repetido em toda linha.
   *
   * O asterisco é a marcação de negrito do próprio WhatsApp, e a IA não
   * assina: ela já se apresenta pelo nome configurado.
   */
  private async assinar(
    senderType: MessageSenderType,
    senderId: string | undefined,
    content: string,
  ): Promise<string> {
    if (senderType !== 'AGENT' || !senderId) return content;

    const settings = await this.inboxSettings.get();
    if (!settings.showAgentName) return content;

    const autor = await this.prisma.db.user.findFirst({
      where: { id: senderId },
      select: { name: true },
    });
    if (!autor) return content;

    // Só o primeiro nome: "Renan" comunica tanto quanto "Renan Santos
    // Ferreira" e não come a primeira linha da mensagem no aparelho.
    const primeiroNome = autor.name.trim().split(/\s+/)[0];
    return `*${primeiroNome}:*\n${content}`;
  }

  /**
   * Aplica um evento de status vindo do webhook do WhatsApp (entregue, lido,
   * falhou) na mensagem correspondente. Nunca regride o status: a Meta não
   * garante ordem de entrega dos webhooks, então um "delivered" atrasado
   * chegando depois de um "read" não pode apagar o tique azul.
   */
  /**
   * Chegou outra mensagem do cliente depois desta?
   *
   * É a pergunta que evita responder pela metade. Ela aparece em dois
   * momentos do mesmo atendimento:
   *
   * - ANTES de chamar o modelo, quando a Evolution entrega um lote — o
   *   caso da sessão que ficou fora do ar e volta com as mensagens
   *   acumuladas. Sem isto, o cliente recebia uma resposta para cada
   *   mensagem de três horas atrás, todas de uma vez.
   *
   * - DEPOIS, porque gerar a resposta leva segundos, e é justamente nesse
   *   intervalo que quem está digitando manda a próxima.
   *
   * Só conta mensagem do CLIENTE: a nossa própria resposta, ou uma nota do
   * sistema, não são pergunta nova.
   */
  private async chegouOutraDepois(mensagem: {
    id: string;
    conversationId: string;
    createdAt: Date;
  }): Promise<boolean> {
    const seguinte = await this.prisma.db.message.findFirst({
      where: {
        conversationId: mensagem.conversationId,
        senderType: 'CUSTOMER',
        id: { not: mensagem.id },
        createdAt: { gte: mensagem.createdAt },
      },
      select: { id: true },
    });

    return Boolean(seguinte);
  }

  /**
   * A mensagem dona de um id externo, com uma rede embaixo.
   *
   * A busca exata resolve tudo no caminho oficial: o `wamid` da Meta é uma
   * string só, escrita igual na ida e na volta. Na Evolution o id externo
   * é uma chave composta (conversa + de quem + id), e o WhatsApp escreve a
   * parte "conversa" de formas diferentes conforme o evento — com sufixo
   * de aparelho, ou como `@lid`, o identificador opaco que esconde o
   * telefone e do qual não se recupera o número.
   *
   * `normalizarJid` já acerta a maioria na gravação. O `@lid` não tem
   * conserto por normalização, e é por ele que esta segunda tentativa
   * existe: o ID DA MENSAGEM é único e nunca muda de forma.
   *
   * A segunda consulta não usa índice (é um LIKE com curinga à esquerda),
   * e é aceitável porque só roda quando a primeira falhou — no caminho
   * oficial, nunca; na Evolution, só nas conversas em `@lid`. O preço de
   * não ter isto era o tique nunca virar.
   */
  private async acharPeloIdExterno(externalId: string) {
    const exata = await this.prisma.db.message.findFirst({
      where: { externalId },
    });
    if (exata) return exata;

    const id = idDaMensagem(externalId);
    if (!id) return null;

    return this.prisma.db.message.findFirst({
      where: { externalId: { endsWith: `|${id}` } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async applyDeliveryStatus(externalId: string, status: MessageStatus) {
    const message = await this.acharPeloIdExterno(externalId);
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
    await this.reabrirSePreciso(conversationId, agentId);
    await this.assumirAoResponder(conversationId, agentId);

    const { message } = await this.persistMessage(conversationId, {
      senderType: 'AGENT',
      senderId: agentId,
      content,
      replyToId,
    });
    return message;
  }

  /**
   * Quem responde, assume — e a IA se cala.
   *
   * Duas coisas acontecem juntas porque o problema é um só: um humano
   * acabou de falar com esse cliente.
   *
   * 1. A conversa sem dono passa a ser de quem respondeu. Era possível
   *    responder e a conversa continuar "sem responsável", então ela seguia
   *    aparecendo como disponível e um colega respondia por cima.
   *
   * 2. A IA para de responder ali. Esta é a mais grave: com ela ativa, a
   *    próxima mensagem do cliente era respondida pelos dois — a pessoa e o
   *    modelo, do mesmo número, possivelmente dizendo coisas diferentes.
   *    Nenhum cliente entende isso, e a empresa fica com as duas respostas
   *    na conta.
   *
   * Conversa que JÁ tem dono não muda de mão aqui: pra isso existe o
   * "Assumir" com confirmação, que registra a troca no histórico.
   *
   * "Ter dono" exige o aceite. Uma INDICAÇÃO pendente
   * (`assignmentAccepted: false`) é o sistema tendo sugerido alguém — pode
   * ter sido a regra de direcionamento, pode ter sido a IA — e essa pessoa
   * ainda não disse que pegou. Enquanto isso, a conversa não é de ninguém.
   *
   * Tratar indicação como posse produzia o pior resultado dos dois lados:
   * quem respondeu de verdade continuava "sem conversa", e o painel exibia
   * como responsável alguém que talvez nem tenha aberto a tela. Foi o caso
   * relatado — a conversa mostrando "Responsável: Lucas" logo depois de ser
   * encaminhada, sem que o Lucas tivesse feito nada. Quem responde
   * primeiro resolve a dúvida na prática, e a indicação some.
   */
  private async assumirAoResponder(conversationId: string, agentId: string) {
    const conversa = await this.prisma.db.conversation.findFirst({
      where: { id: conversationId },
      select: {
        assignedUserId: true,
        assignmentAccepted: true,
        aiMode: true,
      },
    });
    if (!conversa) return;

    const indicadoAOutra =
      Boolean(conversa.assignedUserId) &&
      !conversa.assignmentAccepted &&
      conversa.assignedUserId !== agentId;
    const semDono = !conversa.assignedUserId || indicadoAOutra;
    const iaAtiva = conversa.aiMode === 'AI_ACTIVE';
    if (!semDono && !iaAtiva) return;

    const atualizada = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: {
        ...(semDono ? { assignedUserId: agentId, assignmentAccepted: true } : {}),
        ...(iaAtiva ? { aiMode: 'HUMAN_ACTIVE' as const } : {}),
      },
      include: conversationInclude,
    });

    if (semDono) {
      const nome = atualizada.assignedUser?.name ?? 'Um atendente';
      await this.registrarNota(
        conversationId,
        indicadoAOutra
          ? `${nome} respondeu e assumiu o atendimento, que estava indicado e sem aceite.`
          : `${nome} respondeu e assumiu o atendimento.`,
      );
    }

    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(atualizada),
    );
  }

  /**
   * Responder numa conversa encerrada reabre o atendimento.
   *
   * O "encerrado" é um estado nosso, de organização interna: do outro lado
   * existe uma conversa de WhatsApp como qualquer outra, e o cliente que
   * recebe uma resposta não faz ideia de que alguém teve de reabrir um
   * ticket pra falar com ele. Fazer o atendente encerrar, reabrir e só
   * então escrever seria burocracia que só existe do nosso lado.
   *
   * A empresa pode desligar isso (InboxSettings.allowSendWhenResolved) —
   * operações com auditoria costumam querer que reabrir seja um ato
   * deliberado, e essa é uma decisão de processo, não nossa.
   */
  private async reabrirSePreciso(conversationId: string, agentId: string) {
    const conversa = await this.prisma.db.conversation.findFirst({
      where: { id: conversationId },
      select: { status: true },
    });
    if (conversa?.status !== 'RESOLVED' && conversa?.status !== 'CLOSED') {
      return;
    }

    const settings = await this.inboxSettings.get();
    if (!settings.allowSendWhenResolved) {
      throw new BadRequestException(
        'Esta conversa está encerrada. Reabra antes de responder — ou libere o envio ' +
          'em conversa encerrada em Configurações > Atendimento.',
      );
    }

    const autor = await this.prisma.db.user.findFirst({
      where: { id: agentId },
      select: { name: true },
    });

    await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: { status: 'OPEN', assignedUserId: agentId, assignmentAccepted: true },
    });
    await this.registrarNota(
      conversationId,
      autor?.name
        ? `${autor.name} respondeu e o atendimento foi reaberto.`
        : 'O atendimento foi reaberto por uma nova resposta.',
    );
  }

  /**
   * Reação vinda do cliente. Fica gravada na mensagem reagida (não vira
   * mensagem nova) — emoji vazio significa "removeu a reação", que é como
   * a Meta representa desfazer.
   */
  async applyReaction(externalId: string, emoji: string, from: string) {
    // Mesma rede da entrega: a chave da mensagem reagida chega escrita do
    // jeito do WhatsApp, não do jeito que guardamos (ver acharPeloIdExterno).
    // Sem ela, o cliente reagia e o emoji não aparecia em conversa nenhuma
    // que estivesse em `@lid`.
    const message = await this.acharPeloIdExterno(externalId);
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
      await this.whatsapp.enviarReacao(
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
   * Normaliza áudio pra ogg/opus antes de subir.
   *
   * Converte TUDO que não for ogg, e não só o que a Meta recusa no upload.
   * A distinção importa porque ela é frouxa na porta e rígida na entrega: o
   * mp4 que o MediaRecorder produz passa no upload e é recusado no envio da
   * mensagem, e o atendente fica com um balão de erro sem explicação. O
   * ogg/opus é o formato das mensagens de voz do próprio WhatsApp — é o
   * único que atravessa os dois passos sempre.
   */
  private async prepareAudio<
    T extends { buffer: Buffer; mimetype: string; originalname: string },
  >(file: T): Promise<T> {
    if (!file.mimetype.startsWith('audio/') || jaEhOggOpus(file.mimetype)) {
      return file;
    }

    const convertido = await converterParaOggOpus(file.buffer);
    if (!convertido) {
      // Sem ffmpeg só sobra recusar — mandar assim mesmo produziria
      // exatamente o defeito que esta função existe pra evitar.
      throw new BadRequestException(
        'O servidor da API está sem ffmpeg, então não dá pra converter o áudio ' +
          'pro formato que o WhatsApp reproduz. Instale o ffmpeg no servidor ' +
          '(no Railway, o nixpacks.toml na raiz do projeto já faz isso).',
      );
    }

    return {
      ...file,
      buffer: convertido,
      // O codec vai declarado, e não é detalhe: a Meta documenta que aceita
      // "audio/ogg (somente codecs OPUS)" — ogg puro ela NÃO suporta. Como
      // a porta de upload é leniente e aceita de qualquer jeito, a recusa
      // só aparecia lá na frente, na entrega, como o erro 131053 genérico.
      // O arquivo sempre foi opus; faltava dizer isso pra ela.
      mimetype: 'audio/ogg; codecs=opus',
      originalname: file.originalname.replace(/\.[^.]+$/, '') + '.ogg',
    };
  }

  /**
   * Apaga uma mensagem do painel.
   *
   * Apagamento LÓGICO, e essa é a escolha central: a linha continua no
   * banco com o conteúdo original, e só a exibição muda. Histórico de
   * atendimento é prova — numa cobrança, numa reclamação no Procon ou num
   * processo, o que foi dito importa, e um apagar de verdade transformaria
   * um clique errado em perda de prova. Quem apagou e quando ficam
   * registrados.
   *
   * E há um limite honesto: a Cloud API da Meta NÃO tem como apagar uma
   * mensagem já entregue. O aplicativo do WhatsApp tem ("apagar para
   * todos"), a API não — tanto que este sistema RECEBE avisos de exclusão
   * feitos pelo celular (ver `revoke` no webhook) e não tem como emitir um.
   * Então isto some daqui e permanece no telefone do cliente. A tela diz
   * isso com todas as letras, porque prometer o contrário seria pior que
   * não ter o recurso.
   */
  async apagarMensagem(
    conversationId: string,
    messageId: string,
    quem: { userId: string; role: UserRole; name?: string },
  ) {
    await this.requireConversationExists(conversationId);

    const mensagem = await this.prisma.db.message.findFirst({
      where: { id: messageId, conversationId },
    });
    if (!mensagem) {
      throw new NotFoundException('Mensagem não encontrada.');
    }
    if (mensagem.deletedAt) {
      // Já apagada: devolver o estado atual em vez de erro. Dois cliques
      // não são uma falha.
      return mensagem;
    }
    if (mensagem.senderType === 'CUSTOMER') {
      throw new BadRequestException(
        'Mensagem do cliente não pode ser apagada: ela é registro do que ele disse.',
      );
    }

    // Quem escreveu apaga o que escreveu. Dono e admin apagam qualquer
    // coisa, inclusive resposta da IA — são eles que respondem pelo que a
    // empresa disse.
    const meuTexto =
      mensagem.senderType === 'AGENT' && mensagem.senderId === quem.userId;
    const mandaNaCasa = quem.role === 'OWNER' || quem.role === 'ADMIN';
    if (!meuTexto && !mandaNaCasa) {
      throw new ForbiddenException(
        'Só quem escreveu a mensagem (ou um administrador) pode apagá-la.',
      );
    }

    const atualizada = await this.prisma.db.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), deletedById: quem.userId },
    });

    /*
     * O CONTEÚDO vai pro registro, e este é o único lugar onde ele ainda
     * existe pra ser copiado.
     *
     * Foi escolha explícita do dono do produto, e ela tem um preço que
     * merece estar escrito aqui, não só no schema: o texto que alguém
     * apagou continua legível por dono e admin, pra sempre. Em troca,
     * "apaguei sem querer" e "eu nunca mandei isso" deixam de ser
     * discussões sem árbitro.
     *
     * Registrado no serviço e não no controller (como as outras ações)
     * porque o controller recebe a mensagem JÁ apagada — sem conteúdo
     * nenhum pra guardar. É a exceção que a regra precisa ter.
     */
    await this.audit.registrar(
      { userId: quem.userId, name: quem.name },
      {
        action: 'MENSAGEM_APAGADA',
        conversationId,
        resumo: `Apagou uma mensagem ${mensagem.senderType === 'AI' ? 'da IA' : 'da equipe'}.`,
        snapshot: {
          content: mensagem.content,
          messageType: mensagem.messageType,
          senderType: mensagem.senderType,
          // Defensivo de propósito. O `registrar` já engole a falha DELE,
          // mas montar o argumento acontece antes da chamada — e uma
          // exceção aqui derrubaria a exclusão que está sendo observada,
          // que é justamente o que a auditoria não pode fazer.
          enviadaEm:
            mensagem.createdAt instanceof Date
              ? mensagem.createdAt.toISOString()
              : null,
        },
      },
    );

    this.realtime.emitToTenant(this.prisma.tenantId, 'message.updated', {
      conversationId,
      message: this.esconderApagada(atualizada),
    });

    return atualizada;
  }

  /**
   * Encaminha uma mensagem pra outra conversa. Mídia não é baixada e
   * subida de novo: o id de mídia da Meta é reaproveitado, que é o mesmo
   * que o aplicativo faz e evita um ida-e-volta de megabytes à toa.
   */
  async forwardMessage(
    messageId: string,
    toConversationId: string,
    agentId: string,
  ) {
    const source = await this.prisma.db.message.findFirst({
      where: { id: messageId },
    });
    if (!source) {
      throw new NotFoundException('Mensagem não encontrada.');
    }
    // Apagar e continuar podendo encaminhar não é apagar: o conteúdo já
    // não aparece no painel, mas sairia inteiro pro cliente de outra
    // conversa.
    if (source.deletedAt) {
      throw new BadRequestException(
        'Esta mensagem foi apagada e não pode ser encaminhada.',
      );
    }

    const target = await this.requireConversation(toConversationId);

    if (source.messageType === 'TEXT') {
      return this.sendAgentMessage(toConversationId, agentId, source.content);
    }

    const metadata = (source.metadata ?? {}) as {
      mediaId?: string;
      mimeType?: string;
      fileName?: string;
      size?: number;
    };
    if (!metadata.mediaId) {
      throw new BadRequestException(
        'Esta mídia não pode ser encaminhada: o arquivo dela não está mais disponível.',
      );
    }

    const kind = mediaKindFor(metadata.mimeType ?? '');

    // Encaminhar busca o binário e manda de novo, em vez de reaproveitar o
    // identificador do arquivo. Reaproveitar só funcionava na Meta, onde o
    // arquivo fica hospedado com um id — na Evolution não existe id de
    // arquivo, e o encaminhamento saía sem anexo nenhum.
    const original = await this.whatsapp.baixarMidia(metadata.mediaId);
    if (!original) {
      throw new BadRequestException(
        'Não deu pra buscar o arquivo original para encaminhar. Ele pode ter expirado no WhatsApp.',
      );
    }

    const { externalId, handle } = await this.whatsapp.enviarMidia(
      target.customer.phone,
      {
        buffer: original.buffer,
        mimetype: metadata.mimeType ?? original.mimeType,
        filename: metadata.fileName ?? 'arquivo',
        tipo: kind,
      },
    );

    const message = await this.prisma.db.message.create({
      data: {
        tenantId: this.prisma.tenantId,
        conversationId: toConversationId,
        senderType: 'AGENT',
        senderId: agentId,
        content: source.content,
        messageType: source.messageType,
        externalId,
        // O handle da cópia é o do envio novo, e não o do original: são
        // dois arquivos diferentes do ponto de vista do WhatsApp.
        mediaId: handle,
        metadata: { ...metadata, mediaId: handle } as Prisma.InputJsonValue,
      },
    });

    const updated = await this.prisma.db.conversation.update({
      where: { id: toConversationId },
      data: {
        lastMessageAt: message.createdAt,
        status: 'WAITING_CUSTOMER',
        unreadCount: 0,
        // Anexo e encaminhamento são resposta como qualquer outra: param o
        // relógio da espera. Estes dois caminhos não passam por
        // `persistMessage` (sobem arquivo antes), então precisam dizer
        // isso explicitamente — esquecer aqui deixaria a conversa
        // eternamente no topo da fila depois de uma foto respondida.
        waitingSince: null,
      },
      include: conversationInclude,
    });

    await this.emitirMensagemCriada(toConversationId, message);
    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(updated),
    );

    return message;
  }

  async sendAttachment(
    conversationId: string,
    agentId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    caption?: string,
  ) {
    const conversation = await this.requireConversation(conversationId);
    await this.reabrirSePreciso(conversationId, agentId);
    await this.assumirAoResponder(conversationId, agentId);

    if (conversation.channel !== 'WHATSAPP') {
      throw new BadRequestException(
        'Anexos só valem em conversas de WhatsApp.',
      );
    }

    const toUpload = await this.prepareAudio(file);

    // Rastro do que sai daqui. A Meta aceita o upload e só recusa na
    // ENTREGA quando o arquivo é ruim (erro 131053), e essa recusa chega
    // depois, por webhook, sem dizer o que foi enviado. Sem estas duas
    // linhas no log não há como ligar uma coisa na outra.
    this.logger.log(
      `Anexo recebido: ${file.mimetype} (${file.size} bytes) -> subindo como ` +
        `${toUpload.mimetype} (${toUpload.buffer.length} bytes).`,
    );

    const kind = mediaKindFor(toUpload.mimetype);

    // O ARQUIVO vai pro canal, e não um identificador dele: quem faz o
    // upload em duas etapas é a Meta, por dentro. Antes esta linha subia
    // pra Cloud API sempre — inclusive numa empresa conectada por QR code,
    // que nem tem conta na Meta — e o atendente recebia um erro de
    // credencial no lugar do anexo.
    const { externalId, handle } = await this.whatsapp.enviarMidia(
      conversation.customer.phone,
      {
        buffer: toUpload.buffer,
        mimetype: toUpload.mimetype,
        filename: file.originalname,
        tipo: kind,
        // Áudio convertido pra ogg/opus veio do microfone do painel: é
        // mensagem de voz, não arquivo de música anexado.
        voice: kind === 'audio' && jaEhOggOpus(toUpload.mimetype),
      },
      { caption },
    );

    if (!externalId) {
      // O motivo vem de quem tentou entregar, e é o que separa "arquivo
      // grande demais" de "sessão caída" pra quem está olhando a tela.
      throw new BadRequestException(
        `Não deu pra enviar o anexo: ${this.whatsapp.motivoDaUltimaFalha ?? 'o envio foi recusado'}.`,
      );
    }

    const message = await this.prisma.db.message.create({
      data: {
        tenantId: this.prisma.tenantId,
        conversationId,
        senderType: 'AGENT',
        senderId: agentId,
        // Sem legenda o balão fica só com a mídia. Repetir o nome do
        // arquivo aqui punha "audio-1738...m4a" embaixo de cada áudio e
        // "image.png" embaixo de cada foto — informação que não é fala de
        // ninguém e que o próprio anexo já mostra quando é documento.
        content: caption ?? '',
        messageType: MEDIA_MESSAGE_TYPE[kind],
        externalId,
        // O handle é opaco: na Meta é o id do upload, na Evolution é a
        // chave da mensagem. Quem baixa depois devolve isto ao canal e
        // recebe o binário (ver canal.interface).
        mediaId: handle,
        // Sem id da Meta o anexo NÃO saiu. Marcar como falha é o que faz o
        // triângulo vermelho aparecer no balão: antes ela era gravada como
        // qualquer outra e ficava indistinguível de uma mensagem entregue,
        // então o atendente achava que o cliente tinha recebido o áudio.
        ...(externalId ? {} : { status: 'FAILED' as const }),
        metadata: {
          mediaId: handle,
          // O mime gravado é o que REALMENTE subiu: áudio convertido vira
          // ogg, e registrar o original faria o painel pedir o arquivo com
          // o tipo errado depois.
          mimeType: toUpload.mimetype,
          fileName: file.originalname,
          size: file.size,
          // O porquê fica junto da mensagem, não só no log do servidor:
          // é o que transforma o triângulo vermelho em algo acionável pra
          // quem está atendendo e não tem acesso ao Railway.
          ...(externalId
            ? {}
            : { falha: this.whatsapp.motivoDaUltimaFalha ?? 'a Meta recusou o envio' }),
        } as Prisma.InputJsonValue,
      },
    });

    const updated = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: message.createdAt,
        status: 'WAITING_CUSTOMER',
        unreadCount: 0,
        // Anexo e encaminhamento são resposta como qualquer outra: param o
        // relógio da espera. Estes dois caminhos não passam por
        // `persistMessage` (sobem arquivo antes), então precisam dizer
        // isso explicitamente — esquecer aqui deixaria a conversa
        // eternamente no topo da fila depois de uma foto respondida.
        waitingSince: null,
      },
      include: conversationInclude,
    });

    await this.emitirMensagemCriada(conversationId, message);
    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(updated),
    );

    return message;
  }

  /**
   * Põe uma etiqueta na conversa.
   *
   * Emite `conversation.updated` como qualquer outra mudança de estado: a
   * etiqueta aparece na LISTA, e duas pessoas olhando o mesmo Inbox
   * precisam ver a mesma classificação sem recarregar a página.
   */
  async marcarEtiqueta(conversationId: string, tagId: string) {
    await this.requireConversationExists(conversationId);
    await this.tags.marcar(conversationId, tagId);
    return this.emitirConversaAtualizada(conversationId);
  }

  async desmarcarEtiqueta(conversationId: string, tagId: string) {
    await this.requireConversationExists(conversationId);
    await this.tags.desmarcar(conversationId, tagId);
    return this.emitirConversaAtualizada(conversationId);
  }

  private async emitirConversaAtualizada(conversationId: string) {
    const conversation = await this.prisma.db.conversation.findFirstOrThrow({
      where: { id: conversationId },
      include: conversationInclude,
    });
    const resumo = toSummary(conversation);
    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      resumo,
    );
    return resumo;
  }

  /**
   * Alguém pega a conversa pra si.
   *
   * Vira OPEN, não WAITING_AGENT: "aguardando atendente" quer dizer que
   * falta alguém, e depois de assumir não falta mais. Era esse o motivo de
   * a lista continuar dizendo "aguard. atendente" mesmo depois de clicar
   * em Assumir.
   *
   * Entra já aceito porque a escolha foi da própria pessoa — o aceite só
   * existe pra indicação automática.
   */
  async assign(
    conversationId: string,
    userId: string,
    quemPede?: { role: UserRole; force?: boolean },
  ) {
    const antes = await this.requireConversation(conversationId);

    // Tomar pra si uma conversa que já tem dono não é proibido, mas também
    // não pode ser acidental: duas pessoas respondendo o mesmo cliente é o
    // pior defeito possível num atendimento.
    //
    // Bloquear de vez seria pior — colega em reunião, de férias ou que foi
    // embora às 18h deixaria o cliente sem ninguém. Então: atendente
    // precisa confirmar, dono e admin passam direto (é trabalho deles
    // redistribuir), e a troca fica registrada no histórico da conversa.
    const deOutraPessoa =
      antes.assignedUserId &&
      antes.assignedUserId !== userId &&
      antes.assignmentAccepted;
    const podeRedistribuir =
      quemPede?.role === 'OWNER' || quemPede?.role === 'ADMIN';

    if (deOutraPessoa && !podeRedistribuir && !quemPede?.force) {
      throw new ConflictException(
        `Esta conversa está com ${antes.assignedUser?.name ?? 'outro atendente'}. Confirme para assumir mesmo assim.`,
      );
    }

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: {
        assignedUserId: userId,
        aiMode: 'HUMAN_ACTIVE',
        status: 'OPEN',
        assignmentAccepted: true,
      },
      include: conversationInclude,
    });

    // Só registra quando o dono muda de fato: aceitar uma indicação passa
    // por aqui, e nesse caso a linha "Fulano assumiu" viria depois de
    // "encaminhada para Fulano" — duas notas dizendo a mesma coisa.
    if (antes.assignedUserId !== userId) {
      const nome = conversation.assignedUser?.name ?? 'Um atendente';
      await this.registrarNota(
        conversationId,
        deOutraPessoa
          ? `${nome} assumiu o atendimento, que estava com ${antes.assignedUser?.name}.`
          : `${nome} assumiu o atendimento.`,
      );
    }

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
  /**
   * Reabre uma conversa encerrada. Deve poder: encerrar cedo demais é o
   * erro mais comum de quem atende, e sem reabrir a saída seria criar uma
   * conversa nova — perdendo o histórico justamente no caso em que ele
   * mais importa.
   *
   * Volta como WAITING_AGENT, não OPEN: quem reabriu foi a equipe, então a
   * bola está com ela, não com o cliente. Nada é enviado pro WhatsApp — o
   * cliente não precisa saber que a ficha dele mudou de estado aqui
   * dentro.
   */
  /**
   * Inicia uma conversa com quem nunca escreveu (ou escreveu há mais de 24
   * horas). Só existe via template: fora da janela de atendimento a Meta
   * recusa texto livre, então esse é o único caminho legítimo.
   *
   * Ao contrário dos outros envios, aqui o erro sobe: se a Meta recusou o
   * template, a empresa precisa saber na hora — senão ficaria olhando pra
   * uma conversa vazia sem entender o que houve. Por isso a mensagem só é
   * gravada depois que a Meta confirma.
   */
  /** Templates aprovados, pra tela de iniciar conversa escolher qual usar. */
  async listTemplates() {
    try {
      return await this.whatsapp.listarModelos();
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Não deu pra listar os templates.',
      );
    }
  }

  /**
   * As duas travas que separam "puxar conversa" de "disparar em massa".
   *
   * O canal por QR code é um cliente NÃO OFICIAL do WhatsApp, e a conta
   * pode ser bloqueada por PADRÃO DE COMPORTAMENTO, sem aviso e sem
   * recurso. Falar primeiro com quem nunca escreveu é justamente o
   * comportamento que mais se parece com o de quem faz spam — então é aqui,
   * e só aqui, que vale gastar duas conferências antes de deixar sair.
   *
   * Nenhuma das duas protege contra um bloqueio decidido do outro lado.
   * Elas reduzem a chance; o risco continua existindo por definição, e é
   * por isso que o número usado nunca deveria ser o pessoal de ninguém.
   */
  private async protegerContraBloqueio(phone: string): Promise<void> {
    /*
     * 1. O número existe mesmo?
     *
     * Disparar pra número inexistente é o que quem varre faixas de número
     * faz, e é dos sinais mais fortes de spam que há. Um dígito digitado
     * errado no painel produz exatamente esse sinal.
     *
     * Só barra quando a resposta é um "não" CLARO: `null` quer dizer que
     * não deu pra conferir (servidor fora do ar, sessão caída), e
     * transformar uma indisponibilidade nossa em "esse cliente não existe"
     * seria travar o atendimento por um problema que não é dele.
     */
    const existe = await this.whatsapp.numeroExiste(phone);
    if (existe === false) {
      throw new BadRequestException(
        'Esse número não tem WhatsApp. Confira os dígitos antes de enviar — ' +
          'mandar mensagem pra número que não existe põe a conexão da empresa em risco.',
      );
    }

    /*
     * 2. Quantas abordagens já saíram hoje?
     *
     * Sem teto, esta tela vira ferramenta de prospecção em massa — e é o
     * caminho mais curto pro bloqueio. O limite conta só conversa NASCIDA
     * daqui (`WAITING_CUSTOMER` sem nenhuma mensagem de cliente ainda), e
     * não o volume de atendimento: responder quem escreveu não tem teto
     * nenhum, porque não é isso que derruba conta.
     */
    const desdeMeiaNoite = new Date();
    desdeMeiaNoite.setHours(0, 0, 0, 0);

    const abordagensHoje = await this.prisma.db.conversation.count({
      where: {
        channel: 'WHATSAPP',
        createdAt: { gte: desdeMeiaNoite },
        status: 'WAITING_CUSTOMER',
        messages: { none: { senderType: 'CUSTOMER' } },
      },
    });

    if (abordagensHoje >= TETO_DE_ABORDAGENS_POR_DIA) {
      throw new BadRequestException(
        `Limite de ${TETO_DE_ABORDAGENS_POR_DIA} primeiras abordagens por dia atingido. ` +
          'O limite existe pra proteger a conexão da empresa: falar primeiro com muita ' +
          'gente num dia só é o que faz o WhatsApp bloquear o número. Responder quem ' +
          'escreveu continua sem limite.',
      );
    }
  }

  /**
   * Puxar conversa com quem nunca escreveu.
   *
   * Existe ao lado de `startConversation` porque os dois canais têm
   * regras opostas. Na Cloud API da Meta, falar primeiro exige um modelo
   * aprovado — fora da janela de 24 horas ela recusa texto livre, e quem
   * nunca escreveu nunca abriu janela nenhuma. No canal por QR code não
   * há janela: o aparelho manda uma mensagem comum, igual a qualquer
   * pessoa mandando pelo celular.
   *
   * Como a empresa hoje conecta por QR code, este é o caminho que a tela
   * usa. O outro fica de pé pra quando o canal oficial voltar a ser
   * oferecido — apagá-lo agora seria jogar fora a única implementação
   * correta daquele lado.
   *
   * Reaproveita a conversa aberta quando ela existe: abrir uma segunda
   * partiria o histórico do mesmo cliente em dois lugares no painel.
   */
  async iniciarConversa(
    input: { phone: string; name?: string; content: string },
    agentId: string,
  ) {
    const phone = input.phone.replace(/\D/g, '');
    if (phone.length < 12) {
      throw new BadRequestException(
        'Informe o telefone com DDI e DDD, por exemplo 5527999998888.',
      );
    }

    const texto = input.content.trim();
    if (!texto) {
      throw new BadRequestException('Escreva a mensagem antes de enviar.');
    }

    await this.protegerContraBloqueio(phone);

    const customer = await this.customers.findOrCreateByPhone({
      phone,
      name: input.name?.trim() || phone,
    });

    const existente = await this.prisma.db.conversation.findFirst({
      where: { customerId: customer.id, status: { in: OPEN_STATUSES } },
      orderBy: { lastMessageAt: 'desc' },
    });

    const conversation =
      existente ??
      (await this.prisma.db.conversation.create({
        data: {
          tenantId: this.prisma.tenantId,
          customerId: customer.id,
          channel: 'WHATSAPP',
          // Nasce HUMANA e com dono: quem puxou a conversa é quem está
          // falando. Deixar a IA responder por cima de uma abordagem que
          // uma pessoa começou é o oposto do que se quer aqui.
          aiMode: 'HUMAN_ACTIVE',
          status: 'WAITING_CUSTOMER',
          assignedUserId: agentId,
          assignmentAccepted: true,
        },
      }));

    /*
     * O envio passa pelo caminho normal de resposta.
     *
     * É o que garante que esta mensagem receba o mesmo tratamento de
     * qualquer outra: sai pelo canal, ganha tique de entrega, aparece na
     * tela em tempo real e entra no histórico. Duplicar o envio aqui
     * criaria um segundo caminho que envelheceria sozinho.
     */
    await this.sendAgentMessage(conversation.id, agentId, texto);

    return this.getById(conversation.id);
  }

  async startConversation(
    input: {
      phone: string;
      name?: string;
      templateName: string;
      templateLanguage: string;
      bodyParams?: string[];
    },
    agentId: string,
  ) {
    const phone = input.phone.replace(/\D/g, '');
    if (phone.length < 12) {
      throw new BadRequestException(
        'Informe o telefone com DDI e DDD, por exemplo 5527999998888.',
      );
    }

    const customer = await this.customers.findOrCreateByPhone({
      phone,
      name: input.name?.trim() || phone,
    });

    let externalId: string;
    try {
      externalId = await this.whatsapp.enviarModelo(phone, {
        name: input.templateName,
        language: input.templateLanguage,
        bodyParams: input.bodyParams,
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Não deu pra enviar o template.',
      );
    }

    // Reaproveita a conversa aberta desse cliente quando existe: abrir uma
    // segunda partiria o histórico em duas no painel.
    const existing = await this.prisma.db.conversation.findFirst({
      where: { customerId: customer.id, status: { in: OPEN_STATUSES } },
      orderBy: { lastMessageAt: 'desc' },
    });

    const conversation =
      existing ??
      (await this.prisma.db.conversation.create({
        data: {
          tenantId: this.prisma.tenantId,
          customerId: customer.id,
          channel: 'WHATSAPP',
          status: 'WAITING_CUSTOMER',
          assignedUserId: agentId,
          /*
           * Nasce HUMANA, como o `iniciarConversa` ao lado.
           *
           * Sem isto ela caía no padrão do banco (AI_ACTIVE) e a IA
           * assumia por cima de uma abordagem que uma PESSOA acabou de
           * fazer — o cliente responderia ao atendente e seria atendido
           * pelo robô. É a mesma armadilha que já custou o defeito da
           * saudação automática: um padrão de coluna decidindo
           * comportamento em vez de quem cria a linha.
           */
          aiMode: 'HUMAN_ACTIVE',
        },
      }));

    const message = await this.prisma.db.message.create({
      data: {
        tenantId: this.prisma.tenantId,
        conversationId: conversation.id,
        senderType: 'AGENT',
        senderId: agentId,
        content: `[${input.templateName}] ${(input.bodyParams ?? []).join(' · ')}`.trim(),
        messageType: 'TEXT',
        externalId,
      },
    });

    const updated = await this.prisma.db.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: message.createdAt,
        status: 'WAITING_CUSTOMER',
        waitingSince: null,
      },
      include: conversationInclude,
    });

    await this.emitirMensagemCriada(conversation.id, message);
    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(updated),
    );

    return { conversationId: conversation.id };
  }

  /**
   * Executa o que as travas da IA concluíram (ver ai-guardrails.ts).
   *
   * Existe porque a IA errou o mesmo erro três vezes: escrever "vou
   * transferir" e não transferir. Prompt não corrigiu. Aqui o sistema
   * torna a promessa verdadeira — a conversa vai pra fila humana com o
   * motivo registrado, e a IA para de responder pra não atropelar quem
   * assumir.
   */
  /**
   * Encerra o atendimento que a IA disse ao cliente que estava encerrado.
   *
   * Não repete a mensagem de encerramento das configurações: a IA já se
   * despediu com as próprias palavras, e mandar o texto padrão logo em
   * seguida faria o cliente receber duas despedidas seguidas.
   *
   * Conversa com dono ou já esperando atendente não encerra por aqui —
   * seria tirar da fila um caso que alguém precisa pegar. Nesse cenário a
   * despedida da IA foi um engano dela, e o certo é a conversa continuar
   * viva pra a pessoa assumir.
   */
  private async encerrarPelaIa(conversationId: string, motivo?: string) {
    const atual = await this.prisma.db.conversation.findFirst({
      where: { id: conversationId },
      select: { status: true, assignedUserId: true },
    });
    if (!atual) return null;
    if (atual.assignedUserId || atual.status === 'WAITING_AGENT') return null;
    if (atual.status === 'RESOLVED' || atual.status === 'CLOSED') return null;

    await this.prisma.db.message.create({
      data: {
        tenantId: this.prisma.tenantId,
        conversationId,
        senderType: 'SYSTEM',
        content: motivo
          ? `Atendimento encerrado pela IA. ${motivo}`
          : 'Atendimento encerrado pela IA.',
        messageType: 'TEXT',
      },
    });

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: { status: 'RESOLVED', waitingSince: null },
      include: conversationInclude,
    });

    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(conversation),
    );
    return conversation;
  }

  private async aplicarTravasDaIa(
    conversationId: string,
    verificacao: VerificacaoDaResposta,
    prioridadeAtual: ConversationPriority,
  ) {
    /*
     * A IA avisou que encerrou — então encerra.
     *
     * O defeito: o cliente leu "Atendimento encerrado por aqui" e o painel
     * continuou marcando "aguardando cliente". Os dois lados discordando
     * sobre se o atendimento acabou, e a conversa parada num estado que
     * ninguém ia revisitar.
     *
     * Fica antes do resto porque encerrar e escalar são caminhos opostos:
     * a trava de encerramento só chega aqui quando nenhuma promessa de
     * humano foi detectada (ver ai-guardrails).
     */
    if (verificacao.encerrar) {
      return this.encerrarPelaIa(conversationId, verificacao.motivo);
    }

    if (!verificacao.precisaHandoff && !verificacao.prioridadeMinima) {
      return null;
    }

    const data: Prisma.ConversationUpdateInput = {};

    let prioridadeFinal = prioridadeAtual;
    if (verificacao.prioridadeMinima) {
      const ordem = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 } as const;
      if (ordem[verificacao.prioridadeMinima] > ordem[prioridadeAtual]) {
        prioridadeFinal = verificacao.prioridadeMinima;
      }
    }

    if (verificacao.precisaHandoff) {
      // A trava também respeita a coleta obrigatória.
      //
      // A barreira existia só na ferramenta transferToHuman, que é o
      // caminho em que a IA DECIDE escalar. Mas metade das transferências
      // vem por aqui — a IA prometeu um humano sem chamar ferramenta, ou
      // uma regra de urgência disparou — e por esse caminho a conversa
      // chegava na fila sem nome, sem documento, sem nada. O atendente
      // abria e a primeira coisa que tinha a fazer era perguntar o que o
      // sistema deveria ter perguntado.
      //
      // Aqui não dá pra pedir pro modelo perguntar de novo: ele já
      // respondeu, a resposta já foi gravada e mandada. Então o próprio
      // sistema pergunta, com uma frase montada a partir dos campos que
      // faltam, e adia a transferência pro próximo turno. Determinístico:
      // não depende de o modelo lembrar.
      const faltando = await this.collection.missingRequired(conversationId);
      if (faltando.length > 0) {
        await this.perguntarDadosQueFaltam(conversationId, faltando);
        return null;
      }

      data.status = 'WAITING_AGENT';
      data.aiMode = 'HUMAN_ACTIVE';
      data.escalationReason = verificacao.motivo ?? 'Trava automática.';

      // As regras de "quem atende o quê" valem também quando quem escala é
      // a trava, não a IA. Antes só eram consultadas se a IA nomeasse a
      // regra — então "urgente vai pra fulano" não pegava aqui, que é
      // justamente quando mais importa.
      const destino = await this.routing.resolveByPriority(prioridadeFinal);
      if (destino) {
        if (destino.assignedUserId) {
          data.assignedUser = { connect: { id: destino.assignedUserId } };
          // Indicação, não decisão: a IA erra, e ninguém deve acordar
          // dono de um caso que não aceitou.
          data.assignmentAccepted = false;
        }
        if (destino.queueId) data.queue = { connect: { id: destino.queueId } };
        data.escalationReason = `${verificacao.motivo ?? 'Trava automática.'} (regra: ${destino.ruleName})`;
      }
    }

    // Só sobe, nunca desce: se um atendente já marcou como urgente, uma
    // trava automática não pode rebaixar.
    if (prioridadeFinal !== prioridadeAtual) {
      data.priority = prioridadeFinal;
    }

    if (Object.keys(data).length === 0) return null;

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data,
      include: conversationInclude,
    });

    // Nota visível na conversa: quem abrir precisa entender por que a
    // conversa mudou de estado sozinha.
    if (verificacao.precisaHandoff && verificacao.motivo) {
      await this.prisma.db.message.create({
        data: {
          tenantId: this.prisma.tenantId,
          conversationId,
          senderType: 'SYSTEM',
          content: `Encaminhado para a equipe: ${verificacao.motivo}`,
          messageType: 'TEXT',
        },
      });
    }

    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(conversation),
    );
    return conversation;
  }

  /**
   * Pede ao cliente o que falta antes de passar pra um humano.
   *
   * A frase é montada aqui, não pedida ao modelo: neste ponto ele já
   * respondeu e a resposta já saiu, então não há turno pra ele usar. Sai
   * como mensagem da IA (não do sistema) porque, do lado do cliente, quem
   * está conversando é ela — uma tarja cinza de sistema no meio do papo
   * seria estranha.
   */
  private async perguntarDadosQueFaltam(
    conversationId: string,
    faltando: string[],
  ) {
    const lista =
      faltando.length === 1
        ? faltando[0]
        : `${faltando.slice(0, -1).join(', ')} e ${faltando[faltando.length - 1]}`;

    const pergunta =
      faltando.length === 1
        ? `Antes de te encaminhar pro nosso time, preciso de mais um dado: ${lista}. Pode me informar?`
        : `Antes de te encaminhar pro nosso time, preciso de alguns dados: ${lista}. Pode me informar?`;

    await this.persistMessage(conversationId, {
      senderType: 'AI',
      content: pergunta,
    });

    this.logger.log(
      `Transferência adiada na conversa ${conversationId}: falta coletar ${faltando.join(', ')}.`,
    );
  }

  /**
   * Passa a conversa pra outra pessoa da equipe.
   *
   * Vai como indicação (assignmentAccepted = false): quem recebe confirma
   * antes de virar responsável. Vale tanto pra correção de rota da IA
   * quanto pra passar um caso adiante — em nenhum dos dois o sistema deve
   * decidir sozinho pela agenda de outra pessoa.
   */
  async transferTo(conversationId: string, toUserId: string, byUserId: string) {
    await this.requireConversation(conversationId);

    const destino = await this.prisma.db.user.findFirst({
      where: { id: toUserId, status: 'ACTIVE' },
      select: { id: true, name: true },
    });
    if (!destino) {
      throw new NotFoundException('Colaborador não encontrado.');
    }
    if (toUserId === byUserId) {
      return this.assign(conversationId, byUserId);
    }

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: {
        assignedUserId: toUserId,
        assignmentAccepted: false,
        aiMode: 'HUMAN_ACTIVE',
        status: 'WAITING_AGENT',
      },
      include: conversationInclude,
    });

    await this.prisma.db.message.create({
      data: {
        tenantId: this.prisma.tenantId,
        conversationId,
        senderType: 'SYSTEM',
        content: `Conversa encaminhada para ${destino.name}, aguardando aceite.`,
        messageType: 'TEXT',
      },
    });

    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(conversation),
    );
    return conversation;
  }

  /**
   * Passa a conversa pra um setor, sem escolher pessoa.
   *
   * É o caso mais comum na prática: "isso é do financeiro" raramente
   * significa "isso é da Ana do financeiro". Mandar pro setor deixa a
   * conversa visível pra quem é do setor, e quem estiver livre assume — em
   * vez de ficar parada esperando uma pessoa específica que pode estar de
   * férias.
   *
   * Por isso aqui não há indicação a aceitar: ninguém foi nomeado. A
   * conversa fica sem dono e em WAITING_AGENT, que é exatamente o estado de
   * "alguém do setor precisa pegar isto".
   */
  async transferToQueue(conversationId: string, queueId: string, byUserId: string) {
    await this.requireConversation(conversationId);

    const setor = await this.prisma.db.queue.findFirst({
      where: { id: queueId },
      select: { id: true, name: true },
    });
    if (!setor) {
      throw new NotFoundException('Setor não encontrado.');
    }

    const autor = await this.prisma.db.user.findFirst({
      where: { id: byUserId },
      select: { name: true },
    });

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: {
        queueId,
        assignedUserId: null,
        assignmentAccepted: true,
        aiMode: 'HUMAN_ACTIVE',
        status: 'WAITING_AGENT',
      },
      include: conversationInclude,
    });

    await this.registrarNota(
      conversationId,
      autor?.name
        ? `${autor.name} encaminhou a conversa para o setor ${setor.name}.`
        : `Conversa encaminhada para o setor ${setor.name}.`,
    );

    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(conversation),
    );
    return conversation;
  }

  /**
   * Nota do sistema na conversa. Serve pro histórico contar o que aconteceu:
   * quem assumiu, quem passou pra quem, quando o setor mudou. Sem isso, a
   * conversa muda de dono e o registro fica só no estado atual — quem abrir
   * amanhã não sabe como chegou ali.
   */
  private async registrarNota(conversationId: string, texto: string) {
    const nota = await this.prisma.db.message.create({
      data: {
        tenantId: this.prisma.tenantId,
        conversationId,
        senderType: 'SYSTEM',
        content: texto,
        messageType: 'TEXT',
      },
    });

    // A nota também é anunciada. Antes ela só aparecia depois de alguém
    // recarregar: respondendo numa conversa encerrada, a resposta surgia
    // na hora e a tarja "o atendimento foi reaberto" — que é a explicação
    // do que acabou de acontecer — chegava atrasada, ou nunca.
    await this.emitirMensagemCriada(conversationId, nota);
  }

  /** Quem foi indicado confirma que vai atender. */
  async acceptAssignment(conversationId: string, userId: string) {
    const atual = await this.requireConversation(conversationId);
    if (atual.assignedUserId !== userId) {
      throw new BadRequestException('Esta conversa foi indicada a outra pessoa.');
    }
    return this.assign(conversationId, userId);
  }

  /**
   * Recusa a indicação. A conversa volta pra fila sem dono em vez de ficar
   * pendurada em quem não pode atender — indicação recusada que continua
   * atribuída é pior que nenhuma indicação.
   */
  async declineAssignment(conversationId: string, userId: string, motivo?: string) {
    const atual = await this.requireConversation(conversationId);

    // Já sem dono: a recusa aconteceu (dois cliques, duas abas, ou a tela
    // pintou do cache antes de reconciliar). Devolver o estado atual em vez
    // de erro é o certo — recusar de novo o que já está recusado não é uma
    // falha, e o erro deixava os botões "Aceitar/Recusar" na tela dando a
    // impressão de que a recusa não tinha funcionado.
    if (!atual.assignedUserId) {
      return atual;
    }
    if (atual.assignedUserId !== userId) {
      throw new BadRequestException('Esta conversa foi indicada a outra pessoa.');
    }

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: {
        assignedUserId: null,
        assignmentAccepted: true,
        status: 'WAITING_AGENT',
      },
      include: conversationInclude,
    });

    await this.prisma.db.message.create({
      data: {
        tenantId: this.prisma.tenantId,
        conversationId,
        senderType: 'SYSTEM',
        content: motivo?.trim()
          ? `Indicação recusada: ${motivo.trim()}`
          : 'Indicação recusada. A conversa voltou pra fila.',
        messageType: 'TEXT',
      },
    });

    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(conversation),
    );
    return conversation;
  }

  async reopen(conversationId: string) {
    const before = await this.prisma.db.conversation.findFirst({
      where: { id: conversationId },
      select: { status: true },
    });
    if (!before) {
      throw new NotFoundException('Conversa não encontrada.');
    }
    if (before.status !== 'RESOLVED' && before.status !== 'CLOSED') {
      throw new BadRequestException('Esta conversa já está aberta.');
    }

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: { status: 'WAITING_AGENT' },
      include: conversationInclude,
    });

    this.realtime.emitToTenant(
      this.prisma.tenantId,
      'conversation.updated',
      toSummary(conversation),
    );
    return conversation;
  }

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
      data: {
        status: 'RESOLVED',
        /*
         * O relógio de espera para junto.
         *
         * Ele mede há quanto tempo o cliente aguarda resposta, e uma
         * conversa encerrada não aguarda mais nada. Ficando ligado, a
         * conversa resolvida continuava contando como "esperando" no
         * contador da barra, aparecia com o selo de espera na lista e —
         * na ordenação por fila — subia pro topo, na frente de quem
         * realmente estava sem resposta.
         *
         * O encerramento pela IA já fazia isto (ver ai-tools); o botão de
         * quem atende, não.
         */
        waitingSince: null,
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

  async setAiMode(conversationId: string, aiMode: AiMode) {
    await this.requireConversation(conversationId);

    // Religar a IA numa conversa não pode contrariar a chave geral. Dava
    // pra "reativar a IA" no chat com ela desligada nas configurações: o
    // botão respondia, a conversa voltava pra AI_ACTIVE e o cliente
    // escrevia pra ninguém — a IA continuava calada, e agora sem nenhum
    // humano marcado como responsável.
    if (aiMode === 'AI_ACTIVE') {
      const settings = await this.prisma.db.aiSettings.findFirst({
        select: { active: true, apiKeyEncrypted: true },
      });
      if (!settings?.active) {
        throw new BadRequestException(
          'A IA está desligada nas configurações. Ligue-a em Configurações > IA antes de reativar numa conversa.',
        );
      }
      if (!settings.apiKeyEncrypted) {
        throw new BadRequestException(
          'A IA está sem chave de API. Configure-a em Configurações > IA antes de reativar numa conversa.',
        );
      }
    }

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
    /** A hora em que o cliente escreveu, quando ela não é agora. */
    createdAt?: Date;
    /**
     * É um GRUPO, e não uma pessoa.
     *
     * Grupo reaproveita toda a estrutura de conversa — histórico,
     * etiquetas, busca, anexo — porque tudo isso faz sentido nele. O que
     * muda é decidido por esta bandeira: a IA nunca responde, a saudação
     * não sai, e o relógio de espera não corre.
     */
    grupo?: boolean;
    /**
     * Quem, DENTRO do grupo, escreveu esta mensagem.
     *
     * Sem isso a conversa de grupo é ilegível: quinze mensagens seguidas
     * de gente diferente, todas do mesmo lado do balão, sem nada dizendo
     * quem falou o quê.
     */
    participante?: string;
  }) {
    /**
     * A mesma entrega, de novo.
     *
     * A Meta reenvia o webhook quando não recebe 2xx a tempo — e "a tempo"
     * inclui o tempo que a IA leva pra responder, porque a resposta dela
     * acontece dentro desta chamada. Sem esta conferência, uma reentrega
     * gravava a mensagem do cliente duas vezes e fazia a IA responder duas
     * vezes à mesma pergunta, do mesmo número.
     *
     * O eco do celular e a importação de histórico já se protegiam assim;
     * o caminho principal, que é o mais movimentado, não.
     */
    if (input.externalId) {
      const jaRecebida = await this.prisma.db.message.findFirst({
        where: { externalId: input.externalId },
        select: { id: true, conversationId: true },
      });
      if (jaRecebida) {
        this.logger.log(
          `Entrega repetida ignorada: ${input.externalId} já estava gravada.`,
        );
        const conversa = await this.prisma.db.conversation.findFirst({
          where: { id: jaRecebida.conversationId },
          include: conversationInclude,
        });
        return { conversation: conversa, message: null };
      }
    }

    const customer = await this.customers.findOrCreateByPhone({
      phone: input.customerPhone,
      name: input.customerName,
      grupo: input.grupo,
    });

    let conversation = await this.prisma.db.conversation.findFirst({
      where: { customerId: customer.id, status: { in: OPEN_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });

    // Nada em aberto: ou o cliente volta pra conversa que já teve, ou começa
    // uma nova. Quem decide é a configuração de agrupamento — ver
    // reabrirParaAgrupamento.
    if (!conversation) {
      conversation = await this.reabrirParaAgrupamento(customer.id);
    }

    // Guardado ANTES de gravar a mensagem: é a única janela em que dá pra
    // saber que esta conversa não existia. Depois disso ela tem histórico
    // como qualquer outra.
    let conversaNova = false;
    if (!conversation) {
      conversaNova = true;
      /*
       * A conversa nasce no modo que a empresa REALMENTE tem.
       *
       * O padrão do banco é AI_ACTIVE, e ele valia mesmo pra empresa que
       * nunca configurou IA. O estrago era duplo e silencioso: a saudação
       * automática nunca saía (ela só fala quando a IA não vai falar), e o
       * caminho da IA rodava assim mesmo, batia em "sem credencial" e
       * mandava ao cliente o aviso de indisponibilidade — "Só um instante,
       * vou chamar alguém da equipe".
       *
       * Do lado de fora isso parecia uma primeira resposta automática
       * funcionando com o interruptor desligado. Não era: era a IA
       * fracassando com educação.
       */
      /*
       * Em GRUPO a IA nunca assume, e isto não é configurável.
       *
       * Um robô respondendo cada mensagem de um grupo de quarenta pessoas
       * é constrangedor pra empresa e é padrão de spam pro WhatsApp — o
       * tipo de comportamento que bloqueia número. Grupo nasce humano e
       * continua humano; quem quiser responder, responde.
       */
      const comIa = input.grupo ? false : await this.aiEngine.podeAtender();
      conversation = await this.prisma.db.conversation.create({
        data: {
          tenantId: this.prisma.tenantId,
          customerId: customer.id,
          channel: input.channel ?? 'INTERNAL',
          aiMode: comIa ? 'AI_ACTIVE' : 'HUMAN_ACTIVE',
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

    let inbound: Awaited<ReturnType<ConversationsService['persistMessage']>>;
    try {
      inbound = await this.persistMessage(conversation.id, {
        senderType: 'CUSTOMER',
        content: input.content,
        messageType: input.messageType,
        /*
         * Em grupo, quem falou vai junto do resto do metadado.
         *
         * No metadado e não numa coluna própria porque só o balão de grupo
         * lê isso — criar coluna na tabela que mais cresce do sistema pra
         * um caso que é minoria sairia caro em disco e em índice.
         */
        metadata: input.participante
          ? { ...((input.metadata as object) ?? {}), participante: input.participante }
          : input.metadata,
        externalId: input.externalId,
        replyToId: replyTo?.id,
        createdAt: input.createdAt,
        grupo: input.grupo,
      });
    } catch (erro) {
      // A conferência lá em cima perdeu a corrida pra outra entrega da
      // mesma mensagem — ver `entregaRepetida`. Ela está gravada, a IA já
      // foi acordada pela outra, e o que falta aqui é só não estourar.
      if (!entregaRepetida(erro)) throw erro;
      this.logger.log(
        `Entrega repetida ignorada no ato de gravar: ${input.externalId}.`,
      );
      return {
        conversation: await this.prisma.db.conversation.findFirst({
          where: { id: conversation.id },
          include: conversationInclude,
        }),
        message: null,
      };
    }

    let latestConversation = inbound.conversation;

    /*
     * Áudio virando texto pro atendente humano.
     *
     * Só aqui, e só quando a IA NÃO vai responder, por dois motivos: a IA
     * transcreve sozinha ao montar o contexto (ela precisa, não é
     * configurável), e ela faz isso dentro desta mesma chamada — disparar
     * as duas transcrições em paralelo pagaria a mesma conversão duas
     * vezes, sem ninguém ganhar nada.
     *
     * Sem `await` de propósito: transcrever leva segundos e o webhook que
     * demora é o webhook que a Evolution reenvia. O balão do áudio já está
     * gravado e já apareceu na tela; o texto chega depois, por
     * `message.transcrita`.
     */
    if (
      inbound.message &&
      inbound.message.messageType === 'AUDIO' &&
      conversation.aiMode !== 'AI_ACTIVE'
    ) {
      void this.transcricao.transcreverSeAutomatico(inbound.message.id);
    }

    /*
     * A saudação automática, pra quem não tem IA.
     *
     * Só na ABERTURA da conversa, e só quando a IA não vai responder. As
     * duas condições são o que separa um aviso de cortesia de um robô
     * chato: repetir a cada mensagem transformaria uma conversa de três
     * perguntas em três avisos iguais, e mandar junto com a resposta da
     * IA seria dizer duas vezes a mesma coisa com palavras diferentes.
     *
     * Depois dela, nada mais acontece: a conversa fica na fila esperando
     * gente, que é exatamente o destino de quem não usa IA.
     */
    if (conversaNova && !input.grupo && conversation.aiMode !== 'AI_ACTIVE') {
      const saudada = await this.saudar(conversation.id);
      if (saudada) latestConversation = saudada;
    }

    if (conversation.aiMode === 'AI_ACTIVE' && !(await this.chegouOutraDepois(inbound.message))) {
      const resultado = await this.aiEngine.generateReply(conversation.id);

      /*
       * O cliente escreveu de novo enquanto a IA pensava.
       *
       * A resposta que acabou de sair já nasceu velha: ela viu metade da
       * pergunta. Mandar assim produz o diálogo torto de sempre — a pessoa
       * digita "oi", "tudo bem?", "queria saber o horário", e recebe três
       * respostas, a primeira delas cumprimentando quem já tinha
       * perguntado.
       *
       * Descartar aqui custa uma chamada ao modelo que não vai ser usada,
       * e é o preço certo: a mensagem seguinte está sendo processada agora
       * e vai responder tudo de uma vez, com a pergunta inteira à vista.
       */
      const desatualizada =
        resultado.tipo === 'respondeu' &&
        (await this.chegouOutraDepois(inbound.message));

      if (desatualizada) {
        this.logger.log(
          `Resposta descartada na conversa ${conversation.id}: o cliente escreveu de novo enquanto a IA pensava.`,
        );
      } else if (resultado.tipo === 'respondeu') {
        const aiTurn = await this.persistMessage(conversation.id, {
          senderType: 'AI',
          content: resultado.resposta.content,
        });
        latestConversation = aiTurn.conversation;

        // As travas rodam DEPOIS de gravar a resposta e por último: se a
        // IA prometeu gente e não chamou a ferramenta, o sistema cumpre a
        // promessa por ela. Aplicar antes seria sobrescrito pelo próprio
        // persistMessage, que mexe no status.
        const travada = await this.aplicarTravasDaIa(
          conversation.id,
          resultado.resposta.verificacao,
          latestConversation.priority,
        );
        if (travada) latestConversation = travada;
      } else if (resultado.tipo === 'indisponivel') {
        // A IA não pode responder — desligada no meio do atendimento, sem
        // chave, cota estourada, provedor fora. Antes isso virava silêncio:
        // a mensagem entrava, a IA calava e nada marcava a conversa como
        // pendente de gente. O cliente ficava falando sozinho e ninguém era
        // chamado porque ninguém sabia que precisava chamar.
        //
        // Cai no mesmo caminho de escalonamento das travas, então as regras
        // de "quem atende o quê" também valem aqui.
        // O status de ANTES desta mensagem. `latestConversation` já é o
        // de depois, e receber mensagem de cliente reabre a conversa como
        // OPEN — usá-lo aqui faria a conta dar "não estava esperando"
        // sempre, e o aviso sairia de novo a cada mensagem.
        const jaEsperava = conversation.status === 'WAITING_AGENT';

        const escalada = await this.aplicarTravasDaIa(
          conversation.id,
          { precisaHandoff: true, motivo: resultado.motivo },
          latestConversation.priority,
        );
        if (escalada) latestConversation = escalada;

        /*
         * E o cliente fica sabendo que alguém vem.
         *
         * Escalar resolve o lado de dentro: a conversa aparece na fila e
         * alguém pega. Do lado de fora continuava um silêncio idêntico ao
         * de um sistema quebrado — a pessoa escreveu e nada voltou.
         *
         * Uma vez por espera, e não uma por mensagem: quem manda três
         * mensagens seguidas enquanto a IA está fora recebia três avisos
         * iguais, o que é pior que nenhum. Se a conversa JÁ estava
         * aguardando atendente, o aviso já foi dado.
         */
        if (!jaEsperava) {
          await this.persistMessage(conversation.id, {
            senderType: 'AI',
            content: AVISO_DE_INDISPONIBILIDADE,
          });
        }
      }
    }

    return { conversation: latestConversation, message: inbound.message };
  }

  /**
   * O cliente voltou a escrever depois de um assunto encerrado. Reaproveita
   * a conversa anterior em vez de abrir um card novo.
   *
   * O ponto é o atendente: no WhatsApp de verdade a pessoa tem UMA conversa
   * com a empresa e o histórico inteiro à vista. Abrir um card por assunto
   * espalha o mesmo cliente por vários lugares, e quem atende a segunda
   * mensagem não vê o que foi combinado na primeira.
   *
   * A janela existe porque isso deixa de valer com o tempo: quem escreve
   * três meses depois traz outro caso, e ressuscitar a conversa antiga só
   * confunde. Fora da janela, conversa nova — o histórico continua no
   * perfil do cliente de qualquer forma.
   */
  private async reabrirParaAgrupamento(customerId: string) {
    const settings = await this.inboxSettings.get();
    if (!settings.groupByCustomer) return null;

    const limite = new Date(
      Date.now() - settings.groupWindowHours * 60 * 60 * 1000,
    );

    const anterior = await this.prisma.db.conversation.findFirst({
      where: {
        customerId,
        status: { in: ['RESOLVED', 'CLOSED'] },
        lastMessageAt: { gte: limite },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
    if (!anterior) return null;

    // Quem volta depois do atendimento encerrado é atendido pela IA de novo.
    //
    // Antes o aiMode ficava como estava no encerramento, e como quase todo
    // atendimento termina com um humano no comando, a conversa reabria
    // presa em HUMAN_ACTIVE: o cliente escrevia "Oi" e ninguém respondia —
    // nem a IA, que estava desligada ali, nem um atendente, que não tinha
    // motivo pra estar olhando uma conversa que já havia resolvido.
    //
    // O que foi encerrado, encerrou. A rodada nova começa como qualquer
    // outra: a IA na frente, escalando pra gente quando precisar. Se a IA
    // estiver desligada na empresa, o modo continua humano e a conversa
    // aparece em Pendentes, que é o comportamento correto nesse caso.
    const ia = await this.prisma.db.aiSettings.findFirst({
      select: { active: true, apiKeyEncrypted: true },
    });
    const iaAssume = Boolean(ia?.active && ia.apiKeyEncrypted);

    /*
     * E a rodada nova também não nasce com dono.
     *
     * O card é o mesmo, mas o atendimento é outro. Mantendo o dono da
     * rodada anterior, a conversa voltava já atribuída — e aceita — a quem
     * atendeu antes: pulava a fila, pulava as regras de direcionamento e
     * caía na mesa de alguém que podia estar de folga, em outro setor ou
     * fora do expediente. Era o que se via como "resolvi e, quando o
     * cliente escreveu de novo, foi direto pro atendente".
     *
     * Pior quando a IA reassume: a conversa ficava com a IA no comando e
     * na mesa de um humano ao mesmo tempo, que são duas coisas que não
     * podem valer juntas.
     *
     * Sem dono, ela entra em Pendentes como qualquer atendimento novo e
     * quem estiver disponível assume — pela fila, pelas regras, ou porque
     * respondeu (ver `assumirAoResponder`).
     *
     * O SETOR fica. Ele não é "de quem é", é "que tipo de assunto é" — e é
     * por ele que a equipe certa enxerga a conversa. Zerá-lo esconderia o
     * cliente de quem sempre o atende; quando o assunto novo for de outro
     * setor, as regras de direcionamento corrigem no primeiro
     * escalonamento.
     */
    const reaberta = await this.prisma.db.conversation.update({
      where: { id: anterior.id },
      data: {
        status: 'OPEN',
        assignedUserId: null,
        assignmentAccepted: false,
        /*
         * O motivo do escalonamento anterior sai SEMPRE, e não só quando a
         * IA reassume: ele explica por que a rodada passada foi parar com
         * gente, e deixá-lo faria o painel contar a história velha na
         * conversa nova.
         */
        escalationReason: null,
        escalationSummary: null,
        ...(iaAssume ? { aiMode: 'AI_ACTIVE' as const } : {}),
      },
    });

    await this.prisma.db.message.create({
      data: {
        tenantId: this.prisma.tenantId,
        conversationId: reaberta.id,
        senderType: 'SYSTEM',
        // Dizer que voltou pra fila é o que responde, pra quem atendeu a
        // rodada anterior, por que a conversa saiu da mesa dele.
        content: anterior.assignedUserId
          ? 'O cliente voltou a escrever. O atendimento foi reaberto e devolvido à fila.'
          : 'O cliente voltou a escrever e o atendimento foi reaberto.',
        messageType: 'TEXT',
      },
    });

    return reaberta;
  }

  /**
   * Registra uma mensagem que a empresa mandou pelo celular, não por aqui.
   *
   * Existe por causa do modo de coexistência da Meta: o mesmo número pode
   * ficar no aplicativo WhatsApp Business e na Cloud API ao mesmo tempo, e
   * o que é digitado no celular chega aqui pelo webhook `smb_message_echoes`
   * em vez de `messages`. Sem tratar isso, o painel mostraria a pergunta do
   * cliente e nunca a resposta — o histórico ficaria mentindo.
   *
   * Duas decisões que não são óbvias:
   *
   * 1. A IA é desligada nessa conversa. Alguém de carne e osso acabou de
   *    responder; deixar a IA responder de novo produziria duas respostas
   *    para a mesma pergunta, vindas do mesmo número.
   * 2. A mensagem entra como SENT, não PENDING. Ela já saiu — quem entregou
   *    foi o WhatsApp do celular, e não temos entrega nossa pra confirmar.
   */
  /**
   * Importa uma conversa inteira do histórico anterior ao onboarding.
   *
   * Diferente de tudo o mais aqui: nada dispara. A IA não responde, o
   * WhatsApp não recebe eco, ninguém é notificado, nenhum contador de não
   * lida sobe. É arqueologia — estas mensagens já aconteceram no celular há
   * semanas, e tratá-las como novidade encheria o painel de conversas
   * "urgentes" de meses atrás e faria a IA responder conversa encerrada.
   *
   * Por isso escreve direto na tabela em vez de passar por persistMessage:
   * aquele caminho existe pra mensagem viva, e é ele que dispara tudo isso.
   *
   * @returns quantas mensagens entraram de fato (ignora as repetidas)
   */
  /**
   * Uma conversa só pro histórico inteiro daquele cliente, já encerrada.
   *
   * O que veio do celular é assunto do passado. Se o cliente escrever de
   * novo, o agrupamento (ver `reabrirParaAgrupamento`) reabre esta mesma
   * conversa com o histórico à vista, que é exatamente o desejado.
   *
   * A trava do Postgres existe porque o aparelho manda o histórico em
   * vários lotes AO MESMO TEMPO, e o mesmo contato aparece em mais de um.
   * Procurar e depois criar, sem trava, fazia dois lotes não acharem nada
   * e criarem duas conversas pro mesmo cliente — a pessoa aparecendo duas
   * vezes na lista, com metade da conversa em cada.
   *
   * É por cliente e dura o que dura a transação (duas consultas curtas):
   * lotes de contatos diferentes seguem entrando em paralelo, como antes.
   */
  private async conversaDoHistorico(customerId: string, maisRecente: Date) {
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${customerId})::bigint)`;

      const existente = await tx.conversation.findFirst({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
      });
      if (existente) return existente;

      return tx.conversation.create({
        data: {
          tenantId: this.prisma.tenantId,
          customerId,
          channel: 'WHATSAPP',
          status: 'RESOLVED',
          aiMode: 'HUMAN_ACTIVE',
          lastMessageAt: maisRecente,
        },
      });
    });
  }

  /**
   * O anexo antigo ganha o endereço que faltava nele.
   *
   * As mensagens importadas antes desta mudança foram gravadas só com a
   * chave, e a chave sozinha não abre anexo de conversa que já estava no
   * aparelho: o servidor de mensagens procura aquela mensagem no banco
   * dele, não acha, e responde "Message not found" (ver `evolutionMedia`,
   * em evolution-mensagem). O aparelho manda o histórico de novo a cada
   * pareamento, e é essa segunda passagem que conserta as antigas.
   *
   * Só escreve onde falta: mensagem que já tem o endereço não é tocada, e
   * mensagem sem mídia nenhuma também não. Sem esse recorte, todo lote
   * repetido reescreveria o histórico inteiro.
   */
  private async completarEnderecoDaMidia(
    gravadas: { id: string; externalId: string | null; metadata: Prisma.JsonValue }[],
    chegando: { externalId?: string; metadata?: Prisma.InputJsonValue }[],
  ) {
    const comEndereco = new Map<string, Record<string, unknown>>();
    for (const m of chegando) {
      const midia = (m.metadata as Record<string, unknown> | undefined)
        ?.evolutionMedia;
      if (m.externalId && midia) {
        comEndereco.set(m.externalId, midia as Record<string, unknown>);
      }
    }
    if (comEndereco.size === 0) return;

    for (const gravada of gravadas) {
      if (!gravada.externalId) continue;

      const endereco = comEndereco.get(gravada.externalId);
      if (!endereco) continue;

      const metadata = (gravada.metadata ?? {}) as Record<string, unknown>;
      if (metadata.evolutionMedia) continue;

      try {
        await this.prisma.db.message.update({
          where: { id: gravada.id },
          data: {
            metadata: {
              ...metadata,
              evolutionMedia: endereco,
            } as Prisma.InputJsonValue,
          },
        });
      } catch (erro) {
        // Um anexo que continua sem endereço é um balão sem imagem, e não
        // um lote de histórico perdido.
        this.logger.warn(
          `Não deu pra completar o endereço da mídia de ${gravada.externalId}: ${erro instanceof Error ? erro.message : erro}`,
        );
      }
    }
  }

  async importarHistorico(entrada: {
    customerPhone: string;
    customerName?: string;
    mensagens: {
      daEmpresa: boolean;
      content: string;
      messageType?: MessageType;
      metadata?: Prisma.InputJsonValue;
      externalId?: string;
      createdAt: Date;
    }[];
  }) {
    if (entrada.mensagens.length === 0) return 0;

    const customer = await this.customers.upsertFromAddressBook({
      phone: entrada.customerPhone,
      name: entrada.customerName,
    });

    const maisRecente = entrada.mensagens.reduce(
      (maior, m) => (m.createdAt > maior ? m.createdAt : maior),
      entrada.mensagens[0].createdAt,
    );

    const conversation = await this.conversaDoHistorico(customer.id, maisRecente);

    // Idempotência em lote: a Meta reenvia pedaços do histórico, e sem isto
    // uma reentrega duplicaria conversas inteiras.
    const ids = entrada.mensagens
      .map((m) => m.externalId)
      .filter((id): id is string => Boolean(id));
    const gravadasAntes = ids.length
      ? await this.prisma.db.message.findMany({
          where: { externalId: { in: ids } },
          select: { id: true, externalId: true, metadata: true },
        })
      : [];
    const jaGravadas = new Set(gravadasAntes.map((m) => m.externalId));

    await this.completarEnderecoDaMidia(gravadasAntes, entrada.mensagens);

    /*
     * O lote também se repete por DENTRO.
     *
     * A Evolution manda o histórico em janelas que se sobrepõem, e a
     * mesma mensagem aparece duas vezes no mesmo `messaging-history.set`.
     * A conferência acima só sabe o que já estava no banco — as duas
     * cópias do mesmo lote passavam juntas por ela.
     */
    const noLote = new Set<string>();
    const novas = entrada.mensagens.filter((m) => {
      if (!m.externalId) return true;
      if (jaGravadas.has(m.externalId) || noLote.has(m.externalId)) return false;
      noLote.add(m.externalId);
      return true;
    });
    if (novas.length === 0) return 0;

    /*
     * `skipDuplicates` é a última linha de defesa, e a única que não é uma
     * corrida.
     *
     * Tudo acima é ler e depois escrever: dois lotes chegando no mesmo
     * segundo leem "não tem" ao mesmo tempo e gravam os dois. Com o
     * aparelho despejando milhares de mensagens de uma vez, isso não é
     * caso raro — era o que duplicava a conversa inteira na reconexão.
     * Aqui quem decide é o índice único do banco.
     */
    const gravadas = await this.prisma.db.message.createMany({
      skipDuplicates: true,
      data: novas.map((m) => ({
        tenantId: this.prisma.tenantId,
        conversationId: conversation.id,
        senderType: m.daEmpresa ? ('AGENT' as const) : ('CUSTOMER' as const),
        content: m.content,
        messageType: m.messageType ?? 'TEXT',
        metadata: m.metadata,
        mediaId: mediaIdDe(m.metadata),
        externalId: m.externalId,
        // Já entregue: quem entregou foi o WhatsApp do celular, semanas atrás.
        status: 'SENT' as const,
        createdAt: m.createdAt,
      })),
    });

    await this.prisma.db.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt:
          conversation.lastMessageAt && conversation.lastMessageAt > maisRecente
            ? conversation.lastMessageAt
            : maisRecente,
      },
    });

    // O que o BANCO gravou, e não o que tentamos gravar: é este número que
    // vira a contagem de "trazidas até agora" na tela, e contar as puladas
    // fazia o painel anunciar milhares de mensagens que não existiam.
    return gravadas?.count ?? novas.length;
  }

  /**
   * Manda a primeira resposta da empresa, quando ela pediu isso.
   *
   * Passa por `persistMessage` como qualquer outra mensagem de saída: vai
   * pro WhatsApp, aparece no painel, conta na conversa. O tipo é SYSTEM
   * porque não foi ninguém que escreveu — e é isso que impede a conversa
   * de virar "aguardando cliente" logo depois de ele ter escrito, que era
   * o que a mandaria pro fim da fila em vez do começo.
   *
   * Falhar aqui não pode derrubar o recebimento: a mensagem do cliente já
   * está gravada, e uma saudação que não saiu é menos grave que uma
   * conversa que não entrou.
   */
  private async saudar(conversationId: string) {
    try {
      const settings = await this.inboxSettings.get();
      const texto = settings.greetingMessage?.trim();

      /*
       * `=== true`, e não só a ausência de falsidade.
       *
       * Este é o único lugar do sistema que manda texto ao cliente sem
       * ninguém ter clicado em nada. Um valor que chegue como string, ou
       * como `undefined` de um cliente Prisma defasado, não pode ser lido
       * como permissão: a diferença entre "não sei" e "sim" é a empresa
       * falando em nome próprio sem ter pedido.
       */
      if (settings.greetingEnabled !== true || !texto) {
        // Em nível de log normal, e de propósito: quando alguém disser que
        // a saudação saiu com a opção desligada, é esta linha que separa
        // "o código ignorou a configuração" de "a configuração estava
        // ligada no banco". Sem ela, sobra a palavra de cada um.
        this.logger.log(
          `Saudação automática não enviada na conversa ${conversationId}: greetingEnabled=${String(
            settings.greetingEnabled,
          )}, texto=${texto ? 'presente' : 'vazio'}.`,
        );
        return null;
      }

      this.logger.log(
        `Saudação automática enviada na conversa ${conversationId} (greetingEnabled=true).`,
      );

      const { conversation } = await this.persistMessage(conversationId, {
        senderType: 'AGENT',
        content: texto,
        automatica: true,
      });
      return conversation;
    } catch (erro) {
      this.logger.warn(
        `Não deu pra enviar a saudação automática na conversa ${conversationId}: ${
          erro instanceof Error ? erro.message : erro
        }`,
      );
      return null;
    }
  }

  /**
   * O aparelho apagou "para todos"; o painel acompanha.
   *
   * Antes isto ficava de fora de propósito, com o argumento de que o
   * histórico daqui é registro e não deve mudar. O argumento não se
   * sustenta pra quem está atendendo: a empresa retirou a mensagem
   * porque ela estava errada, o cliente não a vê mais, e o painel seguia
   * mostrando como dito algo que ninguém disse. Quem responde olhando
   * pra ali responde ao que não existe.
   *
   * O conteúdo continua no banco, como no apagar pelo painel: some da
   * tela, permanece pra quem precisar auditar.
   *
   * Silenciosa quando não acha a mensagem: apagar algo que nunca chegou
   * aqui é rotina — mensagem de grupo, de antes da conexão, ou de um tipo
   * que não sabemos traduzir.
   */
  async aplicarApagadaExterna(externalId: string) {
    const mensagem = await this.prisma.db.message.findFirst({
      where: { externalId },
      select: { id: true, conversationId: true, deletedAt: true },
    });
    if (!mensagem || mensagem.deletedAt) return null;

    const atualizada = await this.prisma.db.message.update({
      where: { id: mensagem.id },
      data: { deletedAt: new Date() },
      include: messageInclude,
    });

    this.realtime.emitToTenant(this.prisma.tenantId, 'message.updated', {
      conversationId: mensagem.conversationId,
      message: this.esconderApagada(atualizada),
    });

    return atualizada;
  }

  async recordOutboundEcho(input: {
    customerPhone: string;
    content: string;
    messageType?: MessageType;
    metadata?: Prisma.InputJsonValue;
    externalId?: string;
  }) {
    // Só entra se já existir uma conversa aberta: a empresa responder pelo
    // celular pressupõe que o cliente escreveu antes. Criar conversa a partir
    // de um eco encheria o painel de conversas sem pergunta nenhuma.
    const customer = await this.prisma.db.customer.findFirst({
      where: { phone: input.customerPhone },
      select: { id: true },
    });
    if (!customer) return null;

    const conversation = await this.prisma.db.conversation.findFirst({
      where: { customerId: customer.id, status: { in: OPEN_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
    if (!conversation) return null;

    // Idempotência: a Meta reenvia webhook quando não recebe 2xx a tempo, e
    // sem isto a mesma mensagem apareceria duas vezes na conversa.
    if (input.externalId) {
      const jaTemos = await this.prisma.db.message.findFirst({
        where: { externalId: input.externalId },
        select: { id: true },
      });
      if (jaTemos) return null;
    }

    let gravada: Awaited<ReturnType<ConversationsService['persistMessage']>>;
    try {
      gravada = await this.persistMessage(conversation.id, {
        senderType: 'AGENT',
        content: input.content,
        messageType: input.messageType,
        metadata: input.metadata,
        externalId: input.externalId,
        status: 'SENT',
        // Quem entregou foi o WhatsApp do celular. Reenviar daqui faria o
        // cliente receber a mesma resposta duas vezes.
        jaEntregue: true,
      });
    } catch (erro) {
      // Outra entrega do mesmo eco chegou primeiro — ver `entregaRepetida`.
      if (!entregaRepetida(erro)) throw erro;
      return null;
    }

    if (conversation.aiMode === 'AI_ACTIVE') {
      const atualizada = await this.prisma.db.conversation.update({
        where: { id: conversation.id },
        data: { aiMode: 'HUMAN_ACTIVE' },
        include: conversationInclude,
      });
      this.realtime.emitToTenant(
        this.prisma.tenantId,
        'conversation.updated',
        toSummary(atualizada),
      );
      return { conversation: atualizada, message: gravada.message };
    }

    return gravada;
  }
}
