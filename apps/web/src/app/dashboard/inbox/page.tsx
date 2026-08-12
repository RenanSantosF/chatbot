"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ChatPanel } from "@/components/inbox/chat-panel";
import { ConversationList } from "@/components/inbox/conversation-list";
import { CustomerPanel } from "@/components/inbox/customer-panel";
import { SimulateInboundDialog } from "@/components/inbox/simulate-inbound-dialog";
import { PageHeader } from "@/components/page-header";
import { useRealtime } from "@/components/realtime-provider";
import { apiFetch } from "@/lib/api-client";
import type { ConversationDetail, ConversationSummary, MessageStatus } from "@/lib/types";

export default function InboxPage() {
  // Link vindo da página de Clientes ("abrir conversa") chega com ?c=<id>.
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("c"));
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const selectedIdRef = useRef<string | null>(null);

  const { socket, unreadCounts, setActiveConversationId } = useRealtime();

  useEffect(() => {
    selectedIdRef.current = selectedId;
    setActiveConversationId(selectedId);
    return () => setActiveConversationId(null);
  }, [selectedId, setActiveConversationId]);

  const loadConversations = useCallback(async () => {
    const list = await apiFetch<ConversationSummary[]>("/conversations");
    setConversations(list);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const conversation = await apiFetch<ConversationDetail>(`/conversations/${id}`);
    setDetail(conversation);
  }, []);

  useEffect(() => {
    // Busca inicial: o setState acontece depois da promise resolver, não
    // durante a execução do efeito.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversations()
      .catch(() => toast.error("Não deu pra carregar as conversas."))
      .finally(() => setLoadingList(false));
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null);
      return;
    }
    loadDetail(selectedId).catch(() => toast.error("Não deu pra carregar essa conversa."));
  }, [selectedId, loadDetail]);

  // O socket vive no RealtimeProvider (uma conexão por sessão, em todas as
  // telas); aqui só escutamos o que muda o que está na tela.
  useEffect(() => {
    if (!socket) return;

    const onConnect = () => {
      loadConversations().catch(() => toast.error("Não deu pra atualizar as conversas."));
      if (selectedIdRef.current) {
        loadDetail(selectedIdRef.current).catch(() => {});
      }
    };

    const onConversationUpdated = (updated: ConversationSummary) => {
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === updated.id);
        const next = exists ? prev.map((c) => (c.id === updated.id ? updated : c)) : [updated, ...prev];
        return [...next].sort(
          (a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime(),
        );
      });

      if (selectedIdRef.current === updated.id) {
        setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
      }
    };

    const onMessageCreated = ({
      conversationId,
      message,
    }: {
      conversationId: string;
      message: ConversationDetail["messages"][number];
    }) => {
      if (selectedIdRef.current !== conversationId) return;
      setDetail((prev) =>
        prev && prev.id === conversationId ? { ...prev, messages: [...prev.messages, message] } : prev,
      );
    };

    const onMessageStatus = ({
      conversationId,
      messageId,
      status,
    }: {
      conversationId: string;
      messageId: string;
      status: MessageStatus;
    }) => {
      if (selectedIdRef.current !== conversationId) return;
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.map((m) => (m.id === messageId ? { ...m, status } : m)),
            }
          : prev,
      );
    };

    socket.on("connect", onConnect);
    socket.on("conversation.updated", onConversationUpdated);
    socket.on("message.created", onMessageCreated);
    socket.on("message.status", onMessageStatus);

    return () => {
      socket.off("connect", onConnect);
      socket.off("conversation.updated", onConversationUpdated);
      socket.off("message.created", onMessageCreated);
      socket.off("message.status", onMessageStatus);
    };
  }, [socket, loadConversations, loadDetail]);

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

  async function handleAction(path: string, errorMessage: string) {
    if (!selectedId) return;
    try {
      await apiFetch(`/conversations/${selectedId}/${path}`, { method: "POST" });
    } catch {
      toast.error(errorMessage);
    }
  }

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col gap-4">
      <PageHeader
        title="Inbox"
        description="Conversas em tempo real."
        action={<SimulateInboundDialog onSimulated={loadConversations} />}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-xl border bg-card shadow-sm md:grid-cols-[280px_1fr] xl:grid-cols-[280px_1fr_290px]">
        <div className="hidden overflow-y-auto border-r md:block">
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            unreadCounts={unreadCounts}
            loading={loadingList}
            onSelect={setSelectedId}
          />
        </div>
        <ChatPanel
          conversation={detail}
          sending={sending}
          onSend={handleSend}
          onAssign={() => handleAction("assign", "Não deu pra assumir essa conversa.")}
          onResolve={() => handleAction("resolve", "Não deu pra resolver essa conversa.")}
          onReactivateAi={() => handleAction("reactivate-ai", "Não deu pra reativar a IA.")}
        />
        <div className="hidden overflow-y-auto border-l xl:block">
          <CustomerPanel conversation={detail} />
        </div>
      </div>
    </div>
  );
}
