import type { StatusGroup, InboxFilters } from "@/components/inbox/inbox-filters";
import type { AiMode, ConversationPriority, ConversationStatus } from "@/lib/types";

/** Espelha `STATUS_GROUPS`, no backend (ver `conversations.service.ts`). */
export const STATUS_GROUPS: Record<StatusGroup, ConversationStatus[]> = {
  PENDING: ["OPEN", "WAITING_AGENT", "WAITING_CUSTOMER"],
  WAITING: ["WAITING_CUSTOMER"],
  DONE: ["RESOLVED", "CLOSED"],
};

/**
 * O mínimo que `pertenceAoFiltro` precisa — não `ConversationUpdate`
 * inteiro — porque também recebe itens da LISTA (`ConversationSummary`,
 * na reconciliação do F02), que não tem `escalationReason` e companhia.
 * As duas formas batem estruturalmente com isto.
 */
export interface ConversaParaFiltro {
  status: ConversationStatus;
  aiMode: AiMode;
  priority: ConversationPriority;
  unreadCount: number;
  waitingSince?: string | null;
  assignedUser: { id: string } | null;
  tags?: { id: string }[];
  customer: { name: string; phone: string; isGroup?: boolean };
}

/**
 * A mesma regra de pertencimento que `montarWhere`, no backend, só que
 * aplicada a UMA conversa que já está na mão — não uma consulta ao banco.
 *
 * Existe porque `conversation.updated` chega pra toda conversa que esta
 * pessoa PODE VER (ver F01 — o recorte por setor já filtra isso no
 * servidor), não só pra quem bate com o filtro aberto na tela agora. Sem
 * isto, o Inbox inseria qualquer atualização direto na lista: uma conversa
 * resolvida reaparecia em Pendentes, um grupo entrava na caixa de
 * clientes, a conversa de outro atendente furava "Minhas".
 *
 * Cobre exatamente os filtros que `InboxFilters` expõe hoje — todos
 * calculáveis com o que `conversation.updated` já traz (ver
 * `conversationInclude`, no backend: tags e prévia sempre vêm junto). Um
 * filtro novo que dependa de dado ausente no evento precisaria de outra
 * saída (invalidar e reconsultar), não desta função.
 */
export function pertenceAoFiltro(
  conversa: ConversaParaFiltro,
  filtros: InboxFilters,
  userId: string,
): boolean {
  if ((conversa.customer.isGroup ?? false) !== filtros.grupos) return false;

  const search = filtros.search.trim();
  if (search) {
    const termo = search.toLowerCase();
    const noNome = conversa.customer.name.toLowerCase().includes(termo);
    const noTelefone = conversa.customer.phone.includes(search);
    if (!noNome && !noTelefone) return false;
  }

  if (filtros.status !== "ALL") {
    if (conversa.status !== filtros.status) return false;
  } else if (filtros.grupo !== "ALL") {
    if (!STATUS_GROUPS[filtros.grupo].includes(conversa.status)) return false;
  }

  // "Com a IA" manda na exclusão de Pendentes, do jeito que `montarWhere`
  // também faz — senão "Pendentes + Com a IA" seria sempre um recorte
  // impossível.
  if (filtros.comIa) {
    if (conversa.aiMode !== "AI_ACTIVE") return false;
  } else if (filtros.status === "ALL" && filtros.grupo === "PENDING") {
    if (conversa.aiMode === "AI_ACTIVE") return false;
  }

  if (filtros.mine && conversa.assignedUser?.id !== userId) return false;
  if (filtros.tagId && !conversa.tags?.some((tag) => tag.id === filtros.tagId)) {
    return false;
  }
  if (filtros.priority !== "ALL" && conversa.priority !== filtros.priority) return false;
  if (filtros.unread && conversa.unreadCount <= 0) return false;
  if (filtros.unassigned && conversa.assignedUser !== null) return false;
  if (filtros.waiting && !conversa.waitingSince) return false;

  return true;
}
