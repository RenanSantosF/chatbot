"use client";

import { MessageSquareDashed } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import type { ConversationStatus, ConversationSummary } from "@/lib/types";

const STATUS_LABEL: Record<ConversationStatus, string> = {
  OPEN: "Aberta",
  WAITING_CUSTOMER: "Aguard. cliente",
  WAITING_AGENT: "Aguard. atendente",
  RESOLVED: "Resolvida",
  CLOSED: "Fechada",
};

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

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
  unreadCounts,
  loading,
  onSelect,
}: {
  conversations: ConversationSummary[];
  selectedId: string | null;
  unreadCounts?: Record<string, number>;
  loading?: boolean;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col divide-y">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-start gap-3 p-3">
            <Skeleton className="size-9 shrink-0 rounded-full" />
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
          title="Nenhuma conversa ainda"
          description="Quando alguém mandar mensagem, ela aparece aqui na hora."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y">
      {conversations.map((conversation) => {
        const unread = unreadCounts?.[conversation.id] ?? 0;
        const selected = selectedId === conversation.id;

        return (
          <button
            key={conversation.id}
            type="button"
            onClick={() => onSelect(conversation.id)}
            className={cn(
              "relative flex items-start gap-3 p-3 text-left transition-colors hover:bg-muted/60",
              selected && "bg-muted",
            )}
          >
            {selected ? (
              <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden />
            ) : null}
            <Avatar className="size-9 shrink-0">
              <AvatarFallback className="text-xs">{initials(conversation.customer.name)}</AvatarFallback>
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
                    <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
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
