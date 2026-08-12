"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-client";
import type { ConversationStatus, ConversationSummary, Customer } from "@/lib/types";

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

export function CustomerDetailSheet({
  customer,
  open,
  onOpenChange,
}: {
  customer: Customer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!open || !customer) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    apiFetch<ConversationSummary[]>(`/conversations?customerId=${customer.id}`)
      .then(setConversations)
      .catch(() => setConversations([]))
      .finally(() => setLoading(false));
  }, [open, customer]);

  function openConversation(id: string) {
    onOpenChange(false);
    router.push(`/dashboard/inbox?c=${id}`);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        {customer ? (
          <>
            <SheetHeader className="border-b pb-4">
              <div className="flex items-center gap-3">
                <Avatar className="size-12 shrink-0">
                  <AvatarFallback className="text-base">{initials(customer.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <SheetTitle className="truncate">{customer.name}</SheetTitle>
                  <SheetDescription className="truncate">{customer.phone}</SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div className="flex flex-col gap-1 text-sm">
                {customer.email ? (
                  <p>
                    <span className="text-muted-foreground">E-mail: </span>
                    {customer.email}
                  </p>
                ) : null}
                <p>
                  <span className="text-muted-foreground">Cliente desde: </span>
                  {new Date(customer.createdAt).toLocaleDateString("pt-BR")}
                </p>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Conversas
                </p>
                {loading ? (
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                  </div>
                ) : conversations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma conversa ainda.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {conversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => openConversation(conversation.id)}
                        className="flex items-center justify-between gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="secondary" className="text-[10px]">
                              {STATUS_LABEL[conversation.status]}
                            </Badge>
                            {conversation.queue ? (
                              <Badge variant="outline" className="text-[10px]">
                                {conversation.queue.name}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {conversation.lastMessageAt
                              ? new Date(conversation.lastMessageAt).toLocaleString("pt-BR")
                              : "Sem mensagens"}
                          </p>
                        </div>
                        <MessageCircle className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
