"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api-client";
import { avatarColor, initials } from "@/lib/avatar";
import type { ConversationMessage, ConversationSummary } from "@/lib/types";

interface Page<T> {
  items: T[];
}

/**
 * Escolhe pra qual conversa a mensagem vai. A lista é buscada na hora em
 * vez de reaproveitar a do Inbox de propósito: os filtros que a pessoa
 * deixou aplicados lá não devem esconder um destino possível aqui.
 */
export function ForwardDialog({
  message,
  fromConversationId,
  onClose,
}: {
  message: ConversationMessage | null;
  fromConversationId: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<ConversationSummary[]>([]);
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
      apiFetch<Page<ConversationSummary>>(`/conversations${query}`)
        .then((page) => setOptions(page.items.filter((item) => item.id !== fromConversationId)))
        .catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [search, message, fromConversationId]);

  async function forwardTo(target: ConversationSummary) {
    if (!message) return;
    setSendingTo(target.id);
    try {
      await apiFetch(`/conversations/${fromConversationId}/messages/${message.id}/forward`, {
        method: "POST",
        body: JSON.stringify({ toConversationId: target.id }),
      });
      toast.success(`Encaminhada para ${target.customer.name}.`);
      onClose();
    } catch {
      toast.error("Não deu pra encaminhar essa mensagem.");
    } finally {
      setSendingTo(null);
    }
  }

  return (
    <Sheet open={Boolean(message)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0">
        <SheetHeader>
          <SheetTitle>Encaminhar</SheetTitle>
          <SheetDescription className="line-clamp-2">
            {message?.content || "Anexo"}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar conversa"
              className="h-9 pl-7"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {options.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Nenhuma outra conversa encontrada.
            </p>
          ) : (
            options.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={sendingTo !== null}
                onClick={() => void forwardTo(option)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent disabled:opacity-60"
              >
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback
                    className={`text-xs font-medium ${avatarColor(option.customer.id)}`}
                  >
                    {initials(option.customer.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{option.customer.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{option.customer.phone}</p>
                </div>
                {sendingTo === option.id ? (
                  <span className="ml-auto text-xs text-muted-foreground">Enviando...</span>
                ) : null}
              </button>
            ))
          )}
        </div>

        <div className="border-t px-4 py-3">
          <Button variant="outline" className="w-full" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
