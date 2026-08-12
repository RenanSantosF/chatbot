import type { ConversationPriority } from "@/lib/types";

/**
 * Prioridade tem semântica de estado (urgente = precisa de ação agora), não
 * de identidade, então usa a paleta de status e sempre com o rótulo junto —
 * cor sozinha não é canal confiável.
 */
export const PRIORITY_META: Record<
  ConversationPriority,
  { label: string; short: string; dot: string; chip: string; rank: number }
> = {
  URGENT: {
    label: "Urgente",
    short: "Urgente",
    dot: "bg-red-500",
    chip: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
    rank: 3,
  },
  HIGH: {
    label: "Alta",
    short: "Alta",
    dot: "bg-amber-500",
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    rank: 2,
  },
  NORMAL: {
    label: "Normal",
    short: "Normal",
    dot: "bg-muted-foreground/50",
    chip: "border-border bg-muted text-muted-foreground",
    rank: 1,
  },
  LOW: {
    label: "Baixa",
    short: "Baixa",
    dot: "bg-muted-foreground/30",
    chip: "border-border bg-muted text-muted-foreground",
    rank: 0,
  },
};

export const PRIORITY_ORDER: ConversationPriority[] = ["URGENT", "HIGH", "NORMAL", "LOW"];
