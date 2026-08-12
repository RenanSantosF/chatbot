export type UserRole = "OWNER" | "ADMIN" | "AGENT";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
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

export interface ConversationMessage {
  id: string;
  conversationId: string;
  senderType: MessageSenderType;
  senderId: string | null;
  content: string;
  messageType: string;
  createdAt: string;
}

export interface AssignedUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
}

export interface ConversationSummary {
  id: string;
  status: ConversationStatus;
  aiMode: AiMode;
  priority: ConversationPriority;
  lastMessageAt: string | null;
  createdAt: string;
  customer: Customer;
  assignedUser: AssignedUser | null;
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

export interface AiSettings {
  id: string;
  active: boolean;
  aiName: string;
  tone: AiTone;
  customInstructions: string | null;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
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
