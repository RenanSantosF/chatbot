"use client";

import {
  ChevronDown,
  ChevronUp,
  MessagesSquare,
  Paperclip,
  Search,
  SendHorizonal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/empty-state";
import { avatarColor, initials } from "@/lib/avatar";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/priority";
import { cn } from "@/lib/utils";
import { MessageBubble } from "./message-bubble";
import type { ConversationDetail, ConversationMessage, ConversationPriority } from "@/lib/types";

/**
 * Rótulo do separador de dia, no mesmo espírito do WhatsApp: os dois dias
 * mais recentes ganham nome, o resto vira data. Comparar pela data local
 * (não pelo ISO em UTC) importa: uma mensagem de 21h no Brasil já é "amanhã"
 * em UTC e cairia no balde errado.
 */
function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  const diffDays = Math.round((startOfDay(today) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) return date.toLocaleDateString("pt-BR", { weekday: "long" });
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function sameDay(a: string, b: string): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="sticky top-0 z-10 flex justify-center py-1.5">
      <span className="rounded-full bg-background/90 px-3 py-1 text-[11px] font-medium text-muted-foreground capitalize shadow-xs ring-1 ring-foreground/5 backdrop-blur-sm">
        {label}
      </span>
    </div>
  );
}

function PriorityPicker({
  value,
  onChange,
}: {
  value: ConversationPriority;
  onChange: (priority: ConversationPriority) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-background p-0.5">
      {PRIORITY_ORDER.map((priority) => {
        const meta = PRIORITY_META[priority];
        const active = value === priority;
        return (
          <button
            key={priority}
            type="button"
            title={`Prioridade ${meta.label.toLowerCase()}`}
            aria-pressed={active}
            onClick={() => onChange(priority)}
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span
              className={cn("size-1.5 rounded-full", active ? "bg-primary-foreground" : meta.dot)}
              aria-hidden
            />
            {meta.short}
          </button>
        );
      })}
    </div>
  );
}

export function ChatPanel({
  conversation,
  sending,
  onSend,
  onAssign,
  onResolve,
  onReactivateAi,
  onChangePriority,
  onSendFile,
  replyTo,
  hasOlder,
  onLoadOlder,
  onReply,
  onCancelReply,
  onReact,
}: {
  conversation: ConversationDetail | null;
  sending: boolean;
  onSend: (content: string) => Promise<void>;
  onAssign: () => Promise<void>;
  onResolve: () => Promise<void>;
  onReactivateAi: () => Promise<void>;
  onChangePriority: (priority: ConversationPriority) => Promise<void>;
  onSendFile: (file: File) => Promise<void>;
  replyTo: ConversationMessage | null;
  hasOlder: boolean;
  onLoadOlder: () => Promise<void>;
  onReply: (message: ConversationMessage) => void;
  onCancelReply: () => void;
  onReact: (messageId: string, emoji: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [needle, setNeedle] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Ids das mensagens que casam com a busca, na ordem da conversa. Roda
  // sobre o que já está carregado — que é o mesmo que o WhatsApp Web faz
  // enquanto você não rola pra trás.
  const matches = useMemo(() => {
    const term = needle.trim().toLowerCase();
    if (!term || !conversation) return [] as string[];
    return conversation.messages
      .filter((message) => message.content?.toLowerCase().includes(term))
      .map((message) => message.id);
  }, [needle, conversation]);

  const currentMatchId = matches[matchIndex] ?? null;

  useEffect(() => {
    if (!currentMatchId) return;
    document
      .querySelector(`[data-message-id="${currentMatchId}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentMatchId]);

  useEffect(() => {
    // Não puxa pro fim enquanto a pessoa está navegando pelos resultados.
    if (currentMatchId) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [conversation?.id, conversation?.messages.length, currentMatchId]);

  if (!conversation) {
    return (
      <div className="chat-wallpaper flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={MessagesSquare}
          title="Nenhuma conversa aberta"
          description="Escolha uma conversa na lista ao lado para começar a atender."
        />
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar className="size-9 shrink-0">
            <AvatarFallback className={cn("text-xs font-medium", avatarColor(conversation.customer.id))}>
              {initials(conversation.customer.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{conversation.customer.name}</p>
            <p className="truncate text-xs text-muted-foreground">{conversation.customer.phone}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Buscar nesta conversa"
            title="Buscar nesta conversa"
            onClick={() => setSearchOpen((open) => !open)}
          >
            <Search className="size-4" />
          </Button>
          <PriorityPicker value={conversation.priority} onChange={onChangePriority} />
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

      {searchOpen ? (
        <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={needle}
              onChange={(event) => {
                setNeedle(event.target.value);
                setMatchIndex(0);
              }}
              placeholder="Buscar nesta conversa"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <span className="w-16 text-center text-xs text-muted-foreground tabular-nums">
            {needle.trim() ? `${matches.length ? matchIndex + 1 : 0}/${matches.length}` : ""}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Resultado anterior"
            disabled={matches.length < 2}
            onClick={() => setMatchIndex((i) => (i - 1 + matches.length) % matches.length)}
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Próximo resultado"
            disabled={matches.length < 2}
            onClick={() => setMatchIndex((i) => (i + 1) % matches.length)}
          >
            <ChevronDown className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Fechar busca"
            onClick={() => {
              setSearchOpen(false);
              setNeedle("");
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : null}

      <div className="chat-wallpaper flex flex-1 flex-col gap-1.5 overflow-y-auto p-4">
        {hasOlder ? (
          <div className="flex justify-center pb-2">
            <Button size="sm" variant="secondary" onClick={() => void onLoadOlder()}>
              Carregar mensagens anteriores
            </Button>
          </div>
        ) : null}
        {conversation.messages.map((message: ConversationMessage, index) => {
          const previous = conversation.messages[index - 1];
          const startsNewDay = !previous || !sameDay(previous.createdAt, message.createdAt);
          return (
            <div key={message.id} className="contents">
              {startsNewDay ? <DaySeparator label={dayLabel(message.createdAt)} /> : null}
              <MessageBubble
                message={message}
                highlight={needle.trim()}
                isCurrentMatch={message.id === currentMatchId}
                onReply={onReply}
                onReact={onReact}
              />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {replyTo ? (
        <div className="flex items-center gap-2 border-t bg-muted/60 px-3 py-2">
          <div className="min-w-0 flex-1 border-l-2 border-primary pl-2">
            <p className="text-[11px] font-medium text-primary">
              {replyTo.senderType === "CUSTOMER" ? "Cliente" : "Você"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {replyTo.content || "Anexo"}
            </p>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Cancelar resposta" onClick={onCancelReply}>
            <X className="size-4" />
          </Button>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t bg-card p-3">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Limpa o input pra o mesmo arquivo poder ser reenviado logo
            // depois — sem isso o onChange não dispara na segunda vez.
            event.target.value = "";
            if (file) void onSendFile(file);
          }}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Anexar arquivo"
          title="Anexar imagem, PDF, áudio ou vídeo"
          disabled={isResolved || sending}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={isResolved ? "Conversa resolvida" : "Escreva uma mensagem..."}
          disabled={isResolved || sending}
          className="rounded-md"
        />
        <Button
          type="submit"
          size="icon-lg"
          className="shrink-0"
          aria-label="Enviar mensagem"
          disabled={isResolved || sending || !draft.trim()}
        >
          {sending ? <Spinner /> : <SendHorizonal className="size-4" />}
        </Button>
      </form>
    </div>
  );
}
