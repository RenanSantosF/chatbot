"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Socket } from "socket.io-client";
import { ChatPanel } from "@/components/inbox/chat-panel";
import { ConversationList } from "@/components/inbox/conversation-list";
import { CustomerPanel } from "@/components/inbox/customer-panel";
import { SimulateInboundDialog } from "@/components/inbox/simulate-inbound-dialog";
import { apiFetch } from "@/lib/api-client";
import { connectRealtime } from "@/lib/socket";
import type { ConversationDetail, ConversationSummary } from "@/lib/types";

export default function InboxPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [sending, setSending] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadConversations = useCallback(async () => {
    const list = await apiFetch<ConversationSummary[]>("/conversations");
    setConversations(list);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const conversation = await apiFetch<ConversationDetail>(`/conversations/${id}`);
    setDetail(conversation);
  }, []);

  useEffect(() => {
    // Busca inicial de dados via API, não sincronização com um sistema
    // externo síncrono — o setState acontece dentro do .catch(), após a
    // promise resolver, não durante a execução do efeito em si.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversations().catch(() => toast.error("Não deu pra carregar as conversas."));
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null);
      return;
    }
    loadDetail(selectedId).catch(() => toast.error("Não deu pra carregar essa conversa."));
  }, [selectedId, loadDetail]);

  // Tempo real: uma conexão só, por sessão do painel — reage a mensagens
  // novas e mudanças de conversa em qualquer lugar do tenant.
  useEffect(() => {
    let cancelled = false;

    apiFetch<{ token: string }>("/auth/socket-token").then(({ token }) => {
      if (cancelled) return;
      const socket = connectRealtime(token);
      socketRef.current = socket;

      socket.on("conversation.updated", (updated: ConversationSummary) => {
        setConversations((prev) => {
          const exists = prev.some((c) => c.id === updated.id);
          const next = exists
            ? prev.map((c) => (c.id === updated.id ? updated : c))
            : [updated, ...prev];
          return [...next].sort(
            (a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime(),
          );
        });

        if (selectedIdRef.current === updated.id) {
          setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
        }
      });

      socket.on(
        "message.created",
        ({ conversationId, message }: { conversationId: string; message: ConversationDetail["messages"][number] }) => {
          if (selectedIdRef.current === conversationId) {
            setDetail((prev) =>
              prev && prev.id === conversationId ? { ...prev, messages: [...prev.messages, message] } : prev,
            );
          }
        },
      );
    });

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  async function handleSend(content: string) {
    if (!selectedId) return;
    setSending(true);
    try {
      await apiFetch(`/conversations/${selectedId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
    } catch {
      toast.error("Não deu pra enviar a mensagem.");
    } finally {
      setSending(false);
    }
  }

  async function handleAssign() {
    if (!selectedId) return;
    try {
      await apiFetch(`/conversations/${selectedId}/assign`, { method: "POST" });
    } catch {
      toast.error("Não deu pra assumir essa conversa.");
    }
  }

  async function handleResolve() {
    if (!selectedId) return;
    try {
      await apiFetch(`/conversations/${selectedId}/resolve`, { method: "POST" });
    } catch {
      toast.error("Não deu pra resolver essa conversa.");
    }
  }

  async function handleReactivateAi() {
    if (!selectedId) return;
    try {
      await apiFetch(`/conversations/${selectedId}/reactivate-ai`, { method: "POST" });
    } catch {
      toast.error("Não deu pra reativar a IA.");
    }
  }

  return (
    <div className="flex h-[calc(100vh-6.5rem)] flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-sm text-muted-foreground">Conversas em tempo real.</p>
        </div>
        <SimulateInboundDialog onSimulated={loadConversations} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr_280px] overflow-hidden rounded-lg border">
        <div className="overflow-y-auto border-r">
          <ConversationList conversations={conversations} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <ChatPanel
          conversation={detail}
          sending={sending}
          onSend={handleSend}
          onAssign={handleAssign}
          onResolve={handleResolve}
          onReactivateAi={handleReactivateAi}
        />
        <div className="overflow-y-auto border-l">
          <CustomerPanel conversation={detail} />
        </div>
      </div>
    </div>
  );
}
