"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ChatPanel } from "@/components/inbox/chat-panel";
import { ConversationList } from "@/components/inbox/conversation-list";
import { CustomerPanel } from "@/components/inbox/customer-panel";
import { DEFAULT_FILTERS, InboxFilterBar, type InboxFilters } from "@/components/inbox/inbox-filters";
import { SimulateInboundDialog } from "@/components/inbox/simulate-inbound-dialog";
import { PageHeader } from "@/components/page-header";
import { useRealtime } from "@/components/realtime-provider";
import { apiFetch } from "@/lib/api-client";
import type {
  ConversationDetail,
  ConversationPriority,
  ConversationSummary,
  MessageStatus,
} from "@/lib/types";

function buildQuery(filters: InboxFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== "ALL") params.set("status", filters.status);
  if (filters.priority !== "ALL") params.set("priority", filters.priority);
  if (filters.mine) params.set("mine", "true");
  if (filters.unreadOnly) params.set("unread", "true");
  if (filters.sort === "priority") params.set("sort", "priority");
  const query = params.toString();
  return query ? `/conversations?${query}` : "/conversations";
}

export default function InboxPage() {
  // Link vindo da página de Clientes ("abrir conversa") chega com ?c=<id>.
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("c"));
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_FILTERS);
  const selectedIdRef = useRef<string | null>(null);
  const filtersRef = useRef(filters);

  const { socket, unreadCounts, clearUnread, setActiveConversationId } = useRealtime();

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    setActiveConversationId(selectedId);
    return () => setActiveConversationId(null);
  }, [selectedId, setActiveConversationId]);

  const loadConversations = useCallback(async () => {
    const list = await apiFetch<ConversationSummary[]>(buildQuery(filtersRef.current));
    setConversations(list);
  }, []);

  const loadDetail = useCallback(
    async (id: string) => {
      // Abrir a conversa é o que zera as não lidas no servidor; o contador
      // local do socket precisa acompanhar pra o badge sumir na hora.
      const conversation = await apiFetch<ConversationDetail>(`/conversations/${id}`);
      setDetail(conversation);
      clearUnread(id);
      setConversations((prev) =>
        prev.map((item) => (item.id === id ? { ...item, unreadCount: 0 } : item)),
      );
    },
    [clearUnread],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingList(true);
    loadConversations()
      .catch(() => toast.error("Não deu pra carregar as conversas."))
      .finally(() => setLoadingList(false));
  }, [loadConversations, filters]);

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
        // Uma conversa que não está na lista só entra quando nenhum filtro
        // está ativo — senão ela apareceria furando o filtro escolhido.
        const isFiltered =
          filtersRef.current.status !== "ALL" ||
          filtersRef.current.priority !== "ALL" ||
          filtersRef.current.mine ||
          filtersRef.current.unreadOnly;
        if (!exists && isFiltered) return prev;

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
          ? { ...prev, messages: prev.messages.map((m) => (m.id === messageId ? { ...m, status } : m)) }
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

  // A busca por texto é local de propósito: filtra o que já está na tela sem
  // ida ao servidor, então digitar não pisca a lista inteira.
  const visible = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter(
      (conversation) =>
        conversation.customer.name.toLowerCase().includes(term) ||
        conversation.customer.phone.includes(term),
    );
  }, [conversations, filters.search]);

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

  async function handlePriority(priority: ConversationPriority) {
    if (!selectedId) return;
    try {
      await apiFetch(`/conversations/${selectedId}/priority`, {
        method: "POST",
        body: JSON.stringify({ priority }),
      });
    } catch {
      toast.error("Não deu pra mudar a prioridade.");
    }
  }

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col gap-4">
      <PageHeader
        title="Inbox"
        description="Conversas em tempo real."
        action={<SimulateInboundDialog onSimulated={loadConversations} />}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-xl border bg-card shadow-sm md:grid-cols-[300px_1fr] xl:grid-cols-[300px_1fr_290px]">
        <div className="hidden min-h-0 flex-col border-r md:flex">
          <InboxFilterBar value={filters} onChange={setFilters} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ConversationList
              conversations={visible}
              selectedId={selectedId}
              liveUnread={unreadCounts}
              loading={loadingList}
              onSelect={setSelectedId}
            />
          </div>
        </div>
        <ChatPanel
          conversation={detail}
          sending={sending}
          onSend={handleSend}
          onAssign={() => handleAction("assign", "Não deu pra assumir essa conversa.")}
          onResolve={() => handleAction("resolve", "Não deu pra resolver essa conversa.")}
          onReactivateAi={() => handleAction("reactivate-ai", "Não deu pra reativar a IA.")}
          onChangePriority={handlePriority}
        />
        <div className="hidden overflow-y-auto border-l xl:block">
          <CustomerPanel conversation={detail} />
        </div>
      </div>
    </div>
  );
}
