"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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

function timeLabel(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: ConversationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (conversations.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        Nenhuma conversa ainda. Simule uma mensagem para testar.
      </p>
    );
  }

  return (
    <div className="flex flex-col divide-y overflow-y-auto">
      {conversations.map((conversation) => (
        <button
          key={conversation.id}
          type="button"
          onClick={() => onSelect(conversation.id)}
          className={cn(
            "flex items-start gap-3 p-3 text-left transition-colors hover:bg-muted/60",
            selectedId === conversation.id && "bg-muted",
          )}
        >
          <Avatar className="size-9 shrink-0">
            <AvatarFallback className="text-xs">{initials(conversation.customer.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{conversation.customer.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {timeLabel(conversation.lastMessageAt)}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
      ))}
    </div>
  );
}
