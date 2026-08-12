"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageBubble } from "./message-bubble";
import type { ConversationDetail } from "@/lib/types";

export function ChatPanel({
  conversation,
  sending,
  onSend,
  onAssign,
  onResolve,
  onReactivateAi,
}: {
  conversation: ConversationDetail | null;
  sending: boolean;
  onSend: (content: string) => Promise<void>;
  onAssign: () => Promise<void>;
  onResolve: () => Promise<void>;
  onReactivateAi: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [conversation?.id, conversation?.messages.length]);

  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Selecione uma conversa
      </div>
    );
  }

  const isResolved = conversation.status === "RESOLVED" || conversation.status === "CLOSED";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    await onSend(content);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{conversation.customer.name}</p>
          <p className="truncate text-xs text-muted-foreground">{conversation.customer.phone}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isResolved && (
            <>
              <Button size="sm" variant="outline" onClick={onAssign}>
                Assumir
              </Button>
              <Button size="sm" variant="outline" onClick={onResolve}>
                Resolver
              </Button>
            </>
          )}
          {!isResolved && conversation.aiMode !== "AI_ACTIVE" && (
            <Button size="sm" variant="ghost" onClick={onReactivateAi}>
              Reativar IA
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-[#f3f1ea] p-4 dark:bg-[#0b141a]">
        {conversation.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t p-3">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={isResolved ? "Conversa resolvida" : "Escrever uma mensagem..."}
          disabled={isResolved || sending}
        />
        <Button type="submit" disabled={isResolved || sending || !draft.trim()}>
          Enviar
        </Button>
      </form>
    </div>
  );
}
