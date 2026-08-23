export type UserRole = "OWNER" | "ADMIN" | "AGENT";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** Conta criada pelo dono cuja senha temporária ainda não foi trocada. */
  mustChangePassword?: boolean;
}

export interface SessionTenant {
  id: string;
  name: string;
  slug: string;
}

/**
 * O estado do WhatsApp da empresa, vindo JUNTO com a sessão.
 *
 * Vem daqui, e não só de evento de tempo real, porque quem abre o painel
 * com a sessão já caída não recebeu evento nenhum — ele passou antes de a
 * página existir. Era isso que fazia a faixa de aviso aparecer "só às
 * vezes, raramente".
 */
export interface EstadoDoCanalSessao {
  provedor: "META_CLOUD" | "EVOLUTION";
  estado: "CONECTADO" | "AGUARDANDO_QRCODE" | "DESCONECTADO";
  motivo: string | null;
  /** Já houve conexão alguma vez? Separa "nunca configurou" de "caiu". */
  jaConectou: boolean;
  /**
   * As conversas que já estavam no aparelho ainda estão chegando?
   *
   * Vem do servidor, e não de um cronômetro no navegador: só ele sabe se
   * um lote chegou, e a conta dele sobrevive a recarregar a página e a
   * uma aba de celular congelada em segundo plano.
   */
  historico: {
    importando: boolean;
    mensagens: number;
    /** De 0 a 100, contado pelo aparelho. */
    progresso: number;
  };
}

export interface MeResponse {
  user: SessionUser;
  tenant: SessionTenant;
  canal: EstadoDoCanalSessao;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: "ACTIVE" | "INVITED" | "DISABLED";
  avatar: string | null;
  mustChangePassword?: boolean;
  createdAt: string;
}

/** Colega que pode receber uma conversa transferida. */
export interface Assignable {
  id: string;
  name: string;
  avatar: string | null;
  role: UserRole;
}

export type ConversationStatus = "OPEN" | "WAITING_CUSTOMER" | "WAITING_AGENT" | "RESOLVED" | "CLOSED";
export type AiMode = "AI_ACTIVE" | "HUMAN_ACTIVE" | "AI_ASSIST" | "PAUSED";
export type ConversationPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type MessageSenderType = "CUSTOMER" | "AI" | "AGENT" | "SYSTEM";

export interface Customer {
  id: string;
  name: string;
  /** Só dígitos, para pessoa. Para GRUPO, o JID inteiro (`...@g.us`). */
  phone: string;
  /** É um grupo do WhatsApp, e não uma pessoa. */
  isGroup?: boolean;
  email: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type MessageStatus = "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

export type MessageType = "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "LOCATION" | "OTHER";

export interface MessageMetadata {
  /**
   * Quem, dentro do GRUPO, escreveu esta mensagem.
   *
   * Só existe em conversa de grupo. Sem ele, a conversa é uma sequência de
   * balões do mesmo lado sem dizer quem falou o quê.
   */
  participante?: string;
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
  size?: number;
  voice?: boolean;
  /** Motivo da recusa da Meta, gravado quando o envio falha. */
  falha?: string;
  /** Chave do anexo no bucket próprio, quando já foi arquivado. */
  storageKey?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
  /**
   * O arquivo no NAVEGADOR, enquanto o servidor não devolve o dele.
   *
   * Só existe no balão otimista, e some com ele. É o que faz a prévia da
   * imagem e a duração do áudio aparecerem antes de qualquer viagem à
   * rede — sem isso, o balão nasceria como um retângulo cinza no exato
   * momento em que a pessoa quer ver que deu certo.
   */
  previaLocal?: string;
}

export interface ConversationMessage {
  /**
   * Identidade da mensagem PRA TELA, estável desde o balão otimista.
   *
   * O `id` muda quando a versão do servidor chega (o provisório dá lugar ao
   * de verdade), e o React trata mudança de chave como elemento novo:
   * desmonta o balão e monta outro no lugar, refazendo a animação de
   * entrada. Era a piscada que aparecia um ou dois segundos depois de
   * enviar — o tempo que a API leva pra falar com a Meta antes de
   * responder.
   *
   * Ausente em tudo que veio do servidor; nesses casos o `id` serve de
   * chave, como sempre serviu.
   */
  clientKey?: string;
  id: string;
  conversationId: string;
  senderType: MessageSenderType;
  senderId: string | null;
  /** Nome de quem respondeu, só em mensagem de atendente. */
  senderName?: string | null;
  content: string;
  messageType: MessageType;
  metadata: MessageMetadata | null;
  status: MessageStatus;
  /** Emoji -> quem reagiu (telefone do cliente ou "agent"). */
  reactions: Record<string, string[]> | null;
  /** Quando foi apagada no painel. O conteúdo não vem mais junto. */
  deletedAt?: string | null;
  /**
   * O áudio em texto, quando já foi transcrito.
   *
   * Só existe em mensagem de áudio, e nem em toda uma: depende de a IA ter
   * atendido a conversa, de a empresa ter ligado o automático, ou de
   * alguém ter clicado em transcrever.
   */
  transcricao?: string | null;
  replyToId: string | null;
  replyTo: {
    id: string;
    content: string;
    senderType: MessageSenderType;
    messageType: MessageType;
  } | null;
  createdAt: string;
}

export interface AssignedUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
}

export interface ConversationQueue {
  id: string;
  key: string;
  name: string;
}

export interface ConversationSummary {
  id: string;
  status: ConversationStatus;
  aiMode: AiMode;
  priority: ConversationPriority;
  unreadCount: number;
  lastMessageAt: string | null;
  /**
   * Desde quando o cliente espera resposta. Nulo = a bola não está com a
   * gente. É o que ordena a fila de atendimento.
   */
  waitingSince?: string | null;
  createdAt: string;
  customer: Customer;
  assignedUser: AssignedUser | null;
  /** Falso enquanto o responsável indicado não confirmou (ver API). */
  assignmentAccepted: boolean;
  queue: ConversationQueue | null;
  escalationReason: string | null;
  escalationSummary: string | null;
  collectedData: Record<string, string> | null;
  /** Etiquetas da conversa, na ordem em que foram postas. */
  tags?: Tag[];
  /** Só a mensagem mais recente, pra prévia na lista. */
  lastMessage?: { content: string; senderType: MessageSenderType; messageType: MessageType } | null;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
}

export type AiToolPermission = "ALLOW" | "DENY" | "REQUIRES_APPROVAL";

export interface ConfiguredTool {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  permission: AiToolPermission;
}

export interface QueueMemberUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
}

export interface QueueMember {
  id: string;
  userId: string;
  user: QueueMemberUser;
}

export interface Queue {
  id: string;
  key: string;
  name: string;
  description: string | null;
  members: QueueMember[];
}

export type TaskStatus = "OPEN" | "DONE";

export interface Task {
  id: string;
  conversationId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  createdByAi: boolean;
  createdAt: string;
}

export type AiTone = "PROFESSIONAL" | "FRIENDLY" | "CASUAL" | "OBJECTIVE" | "WARM";

export type AiMemoryMode = "NONE" | "IMPORTANT_ONLY" | "FULL";

export interface AiSettings {
  id: string;
  active: boolean;
  aiName: string;
  tone: AiTone;
  customInstructions: string | null;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  model: string | null;
  memoryMode: AiMemoryMode;
}

export type KnowledgeDocumentStatus = "PROCESSING" | "READY" | "FAILED";

export interface KnowledgeDocument {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  status: KnowledgeDocumentStatus;
  errorMessage: string | null;
  createdAt: string;
}

export interface AiInstruction {
  id: string;
  title: string;
  content: string;
  priority: number;
  active: boolean;
  createdAt: string;
}

export interface MetricsOverview {
  range: { from: string; to: string };
  totals: {
    conversations: number;
    messages: number;
    resolvedByAi: number;
    resolvedByHuman: number;
    aiMessages: number;
    agentMessages: number;
  };
  byDay: { day: string; conversations: number; messages: number }[];
  byStatus: { status: ConversationStatus; count: number }[];
  responseTime: {
    aiSeconds: number | null;
    humanSeconds: number | null;
    overallSeconds: number | null;
    answered: number;
    unanswered: number;
  };
}

export interface WhatsAppSettings {
  connected: boolean;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  wabaId: string | null;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  webhookUrl: string;
  /**
   * MANUAL = o cliente criou app próprio no Meta Developers e colou os
   * dados. EMBEDDED_SIGNUP = conectou pelo botão, sob o app da plataforma.
   * Nulo quando o WhatsApp ainda não foi conectado.
   */
  onboarding: "MANUAL" | "EMBEDDED_SIGNUP" | null;
  /**
   * Estado da coexistência (mesmo número no aplicativo do celular e na
   * Cloud API). Nulo quando o WhatsApp ainda nem foi conectado.
   */
  coexistencia: {
    /** Falso = a Meta nunca mandou nada de coexistência ainda. */
    ativa: boolean;
    vistaEm: string | null;
    historicoProgresso: number;
    historicoConcluidoEm: string | null;
    historicoMensagens: number;
    historicoErro: string | null;
    contatosSincronizadosEm: string | null;
    contatos: number;
  } | null;
}

export interface RoutingRuleTargetUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
}

export interface RoutingRule {
  id: string;
  key: string;
  name: string;
  subject: string;
  minPriority: ConversationPriority;
  targetUserId: string | null;
  targetQueueId: string | null;
  active: boolean;
  priorityOrder: number;
  targetUser: RoutingRuleTargetUser | null;
  targetQueue: ConversationQueue | null;
}

export interface PermissionMatrix {
  catalog: { group: string; items: { key: string; label: string }[] }[];
  roles: { role: string; permissions: Record<string, boolean> }[];
}

export type CollectionFieldType = "TEXT" | "EMAIL" | "PHONE" | "DOCUMENT" | "DATE" | "NUMBER";
export type CollectionFieldTarget = "NAME" | "EMAIL" | "METADATA";

export interface CollectionField {
  id: string;
  key: string;
  label: string;
  description: string | null;
  type: CollectionFieldType;
  target: CollectionFieldTarget;
  required: boolean;
  order: number;
  active: boolean;
}

export interface InboxSettings {
  id: string;
  sendReadReceipts: boolean;
  /** A primeira resposta automática, sem IA. Ver a tela de Atendimento. */
  greetingEnabled: boolean;
  greetingMessage: string;
  notifyOnResolve: boolean;
  resolveMessage: string;
  /** Responder numa conversa encerrada reabre o atendimento? */
  allowSendWhenResolved: boolean;
  groupByCustomer: boolean;
  groupWindowHours: number;
  autoCloseIdle: boolean;
  autoCloseHours: number;
  /** Avisa o cliente antes de encerrar por inatividade. */
  autoCloseNotify: boolean;
  autoCloseMessage: string;
  showAgentName: boolean;
  queueVisibility: "ALL" | "OWN_QUEUES";
  /**
   * O que fazer com o áudio do cliente quando quem responde é gente.
   *
   * O atendimento da IA não passa por aqui: ela transcreve sempre, porque
   * sem ouvir não tem o que responder.
   */
  transcricaoDeAudio: "DESLIGADA" | "SOB_DEMANDA" | "AUTOMATICA";
  /**
   * Faixas de atendimento por dia da semana, domingo em "0".
   *
   *     { "1": [["08:00", "12:00"], ["13:00", "18:00"]] }
   *
   * `null` é "não configurado": a empresa atende em qualquer horário.
   */
  businessHours: Record<string, [string, string][]> | null;
}

/** Anotação interna na ficha do cliente. Nunca vai pro cliente. */
export interface CustomerNote {
  id: string;
  content: string;
  isPending: boolean;
  dueAt: string | null;
  doneAt: string | null;
  createdAt: string;
  author: { id: string; name: string } | null;
}

/**
 * Texto pronto que o atendente insere no compositor digitando `/atalho`.
 *
 * O `shortcut` chega já normalizado pela API (minúsculo, sem acento, sem
 * espaço) — é a forma que se digita, não a que se cadastrou.
 */
export interface QuickReply {
  id: string;
  shortcut: string;
  /** Rótulo curto da lista. Vazio, a primeira linha do texto serve. */
  title: string | null;
  content: string;
  usageCount: number;
}

/**
 * Etiqueta de conversa ("Orçamento", "Reclamação", "Segunda via").
 *
 * A cor vem como NOME do tom, não como hexadecimal: o painel tem tema claro
 * e escuro, e cada tom precisa de um par de valores diferente nos dois.
 */
export interface Tag {
  id: string;
  name: string;
  color: string;
  /** Só na tela de configuração — a lista do Inbox não precisa. */
  conversationCount?: number;
}
