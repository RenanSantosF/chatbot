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

export interface MeResponse {
  user: SessionUser;
  tenant: SessionTenant;
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

export type ConversationStatus = "OPEN" | "WAITING_CUSTOMER" | "WAITING_AGENT" | "RESOLVED" | "CLOSED";
export type AiMode = "AI_ACTIVE" | "HUMAN_ACTIVE" | "AI_ASSIST" | "PAUSED";
export type ConversationPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type MessageSenderType = "CUSTOMER" | "AI" | "AGENT" | "SYSTEM";

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type MessageStatus = "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

export interface ConversationMessage {
  id: string;
  conversationId: string;
  senderType: MessageSenderType;
  senderId: string | null;
  content: string;
  messageType: string;
  status: MessageStatus;
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
  createdAt: string;
  customer: Customer;
  assignedUser: AssignedUser | null;
  queue: ConversationQueue | null;
  escalationReason: string | null;
  escalationSummary: string | null;
  collectedData: Record<string, string> | null;
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
