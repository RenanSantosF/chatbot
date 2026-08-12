"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ChatPanel } from "@/components/inbox/chat-panel";
import { ConversationList } from "@/components/inbox/conversation-list";
import { CustomerPanel } from "@/components/inbox/customer-panel";
import {
  buildFilterCounts,
  DEFAULT_FILTERS,
  InboxFilterBar,
  type InboxFilters,
} from "@/components/inbox/inbox-filters";
import { SimulateInboundDialog } from "@/components/inbox/simulate-inbound-dialog";
import { PageHeader } from "@/components/page-header";
import { useRealtime } from "@/components/realtime-provider";
import { apiFetch } from "@/lib/api-client";
import { PRIORITY_META } from "@/lib/priority";
import type {
  ConversationDetail,
  ConversationPriority,
  ConversationSummary,
  MeResponse,
  MessageStatus,
} from "@/lib/types";

export default function InboxPage() {
  // Link vindo da página de Clientes ("abrir conversa") chega com ?c=<id>.
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("c"));
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_FILTERS);
  const selectedIdRef = useRef<string | null>(null);

  const { socket, unreadCounts, clearUnread, setActiveConversationId } = useRealtime();

  useEffect(() => {
    selectedIdRef.current = selectedId;
    setActiveConversationId(selectedId);
    return () => setActiveConversationId(null);
  }, [selectedId, setActiveConversationId]);

  useEffect(() => {
    apiFetch<MeResponse>("/auth/me")
      .then((me) => setCurrentUserId(me.user.id))
      .catch(() => {});
  }, []);

  // Busca a lista inteira uma vez e filtra aqui. Assim os contadores de
  // cada filtro batem com a realidade (um filtro no servidor esconderia
  // justamente o que a contagem precisa ver) e trocar de filtro é instantâneo.
  const loadConversations = useCallback(async () => {
    const list = await apiFetch<ConversationSummary[]>("/conversations");
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
        return exists ? prev.map((c) => (c.id === updated.id ? updated : c)) : [updated, ...prev];
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

  const counts = useMemo(
    () => buildFilterCounts(conversations, currentUserId),
    [conversations, currentUserId],
  );

  const visible = useMemo(() => {
    const term = filters.search.trim().toLowerCase();

    const filtered = conversations.filter((conversation) => {
      if (filters.status !== "ALL" && conversation.status !== filters.status) return false;
      if (filters.priority !== "ALL" && conversation.priority !== filters.priority) return false;
      if (filters.scope === "UNREAD" && conversation.unreadCount === 0) return false;
      if (filters.scope === "MINE" && conversation.assignedUser?.id !== currentUserId) return false;
      if (filters.scope === "UNASSIGNED" && conversation.assignedUser) return false;
      if (
        term &&
        !conversation.customer.name.toLowerCase().includes(term) &&
        !conversation.customer.phone.includes(term)
      ) {
        return false;
      }
      return true;
    });

    const byRecent = (a: ConversationSummary, b: ConversationSummary) =>
      new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime();

    return filtered.sort((a, b) => {
      if (filters.sort === "priority") {
        const diff = PRIORITY_META[b.priority].rank - PRIORITY_META[a.priority].rank;
        if (diff !== 0) return diff;
      }
      return byRecent(a, b);
    });
  }, [conversations, filters, currentUserId]);

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

  async function handleSendFile(file: File) {
    if (!selectedId) return;
    setSending(true);
    try {
      const body = new FormData();
      body.append("file", file);
      await apiFetch(`/conversations/${selectedId}/attachments`, { method: "POST", body });
    } catch {
      toast.error("Não deu pra enviar o arquivo.");
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

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-lg border bg-card shadow-sm md:grid-cols-[310px_1fr] xl:grid-cols-[310px_1fr_290px]">
        <div className="hidden min-h-0 flex-col border-r md:flex">
          <InboxFilterBar value={filters} counts={counts} onChange={setFilters} />
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
          onSendFile={handleSendFile}
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
