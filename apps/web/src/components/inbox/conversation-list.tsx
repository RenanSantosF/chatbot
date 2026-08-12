"use client";

import { MessageSquareDashed } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { avatarColor, initials } from "@/lib/avatar";
import { PRIORITY_META } from "@/lib/priority";
import { cn } from "@/lib/utils";
import type { ConversationStatus, ConversationSummary } from "@/lib/types";

const STATUS_LABEL: Record<ConversationStatus, string> = {
  OPEN: "Aberta",
  WAITING_CUSTOMER: "Aguard. cliente",
  WAITING_AGENT: "Aguard. atendente",
  RESOLVED: "Resolvida",
  CLOSED: "Fechada",
};

/** Relativo e curto, como numa lista de conversas de mensageiro. */
function timeLabel(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);

  if (diffDays === 0) return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) return date.toLocaleDateString("pt-BR", { weekday: "short" });
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function ConversationList({
  conversations,
  selectedId,
  liveUnread,
  loading,
  onSelect,
}: {
  conversations: ConversationSummary[];
  selectedId: string | null;
  /** Não lidas que chegaram via socket depois do último carregamento. */
  liveUnread?: Record<string, number>;
  loading?: boolean;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col divide-y">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-start gap-3 p-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={MessageSquareDashed}
          title="Nenhuma conversa aqui"
          description="Ajuste os filtros acima ou espere alguém mandar mensagem."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y">
      {conversations.map((conversation) => {
        // O contador do banco é a verdade; o do socket cobre o intervalo
        // entre a última busca e agora, sem precisar refazer a lista.
        const unread = Math.max(conversation.unreadCount, liveUnread?.[conversation.id] ?? 0);
        const selected = selectedId === conversation.id;
        const priority = PRIORITY_META[conversation.priority];
        const showPriority = conversation.priority === "URGENT" || conversation.priority === "HIGH";

        return (
          <button
            key={conversation.id}
            type="button"
            onClick={() => onSelect(conversation.id)}
            className={cn(
              "relative flex items-start gap-3 p-3 text-left transition-colors hover:bg-muted/60",
              selected && "bg-muted",
              !selected && unread > 0 && "bg-primary/[0.04]",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0 w-0.5",
                selected ? "bg-primary" : unread > 0 ? "bg-primary/45" : "bg-transparent",
              )}
              aria-hidden
            />
            <Avatar className="size-10 shrink-0">
              <AvatarFallback className={cn("text-xs font-medium", avatarColor(conversation.customer.id))}>
                {initials(conversation.customer.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className={cn("truncate text-sm", unread > 0 ? "font-semibold" : "font-medium")}>
                  {conversation.customer.name}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={cn(
                      "text-[11px]",
                      unread > 0 ? "font-medium text-primary" : "text-muted-foreground",
                    )}
                  >
                    {timeLabel(conversation.lastMessageAt)}
                  </span>
                  {unread > 0 ? (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {showPriority ? (
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium",
                      priority.chip,
                    )}
                  >
                    <span className={cn("size-1.5 rounded-full", priority.dot)} aria-hidden />
                    {priority.short}
                  </span>
                ) : null}
                <Badge variant="secondary" className="text-[10px]">
                  {STATUS_LABEL[conversation.status]}
                </Badge>
                {conversation.assignedUser ? (
                  <Badge variant="outline" className="text-[10px]">
                    {conversation.assignedUser.name.split(" ")[0]}
                  </Badge>
                ) : null}
                {conversation.queue ? (
                  <Badge variant="outline" className="text-[10px]">
                    {conversation.queue.name}
                  </Badge>
                ) : null}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
