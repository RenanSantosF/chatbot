"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ChatPanel } from "@/components/inbox/chat-panel";
import { ConversationList } from "@/components/inbox/conversation-list";
import { CustomerPanel } from "@/components/inbox/customer-panel";
import {
  DEFAULT_FILTERS,
  InboxFilterBar,
  type FilterCounts,
  type InboxFilters,
} from "@/components/inbox/inbox-filters";
import { SimulateInboundDialog } from "@/components/inbox/simulate-inbound-dialog";
import { useRealtime } from "@/components/realtime-provider";
import { apiFetch } from "@/lib/api-client";
import { conversationCache } from "@/lib/conversation-cache";
import { usePersistedState } from "@/lib/use-persisted-state";
import type {
  ConversationDetail,
  ConversationMessage,
  ConversationPriority,
  ConversationSummary,
  MessageStatus,
} from "@/lib/types";

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const EMPTY_COUNTS: FilterCounts = {
  total: 0,
  unread: 0,
  mine: 0,
  unassigned: 0,
  status: {},
  priority: {},
};

function buildQuery(filters: InboxFilters, cursor?: string | null): string {
  const params = new URLSearchParams();
  if (filters.status !== "ALL") params.set("status", filters.status);
  if (filters.priority !== "ALL") params.set("priority", filters.priority);
  if (filters.scope === "MINE") params.set("mine", "true");
  if (filters.scope === "UNREAD") params.set("unread", "true");
  if (filters.scope === "UNASSIGNED") params.set("unassigned", "true");
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/conversations?${query}` : "/conversations";
}

export default function InboxPage() {
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("c"));
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messagesCursor, setMessagesCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState<FilterCounts>(EMPTY_COUNTS);
  const [sending, setSending] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [replyTo, setReplyTo] = useState<ConversationMessage | null>(null);

  // Filtros sobrevivem a recarregar e a sair da tela — quem trabalha o dia
  // todo no Inbox não quer reconfigurar a cada volta.
  const [filters, setFilters, filtersReady] = usePersistedState<InboxFilters>(
    "inbox-filters",
    DEFAULT_FILTERS,
  );

  const selectedIdRef = useRef<string | null>(null);
  const { socket, unreadCounts, clearUnread, setActiveConversationId } = useRealtime();

  useEffect(() => {
    selectedIdRef.current = selectedId;
    setActiveConversationId(selectedId);
    return () => setActiveConversationId(null);
  }, [selectedId, setActiveConversationId]);

  const loadCounts = useCallback(() => {
    apiFetch<FilterCounts>("/conversations/counts").then(setCounts).catch(() => {});
  }, []);

  const loadConversations = useCallback(async (current: InboxFilters) => {
    const page = await apiFetch<Page<ConversationSummary>>(buildQuery(current));
    setConversations(page.items);
    setCursor(page.nextCursor);
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<Page<ConversationSummary>>(buildQuery(filters, cursor));
      // Concatena filtrando duplicatas: entre uma página e outra uma
      // conversa pode ter subido pro topo e apareceria duas vezes.
      setConversations((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      toast.error("Não deu pra carregar mais conversas.");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, filters]);

  const loadDetail = useCallback(
    async (id: string) => {
      const conversation = await apiFetch<
        ConversationDetail & { messagesCursor: string | null }
      >(`/conversations/${id}`);
      conversationCache.set(id, {
        detail: conversation,
        messagesCursor: conversation.messagesCursor,
      });
      // Só aplica se a pessoa ainda está nessa conversa: numa troca rápida
      // a resposta antiga chegaria depois e sobrescreveria a nova.
      if (selectedIdRef.current === id) {
        setDetail(conversation);
        setMessagesCursor(conversation.messagesCursor);
      }
      clearUnread(id);
      setConversations((prev) =>
        prev.map((item) => (item.id === id ? { ...item, unreadCount: 0 } : item)),
      );
      loadCounts();
    },
    [clearUnread, loadCounts],
  );

  const loadOlderMessages = useCallback(async () => {
    if (!messagesCursor || !selectedIdRef.current) return;
    const page = await apiFetch<Page<ConversationMessage>>(
      `/conversations/${selectedIdRef.current}/messages?cursor=${messagesCursor}`,
    );
    setDetail((prev) => (prev ? { ...prev, messages: [...page.items, ...prev.messages] } : prev));
    setMessagesCursor(page.nextCursor);
  }, [messagesCursor]);

  useEffect(() => {
    if (!filtersReady) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingList(true);
    const timer = setTimeout(() => {
      loadConversations(filters)
        .catch(() => toast.error("Não deu pra carregar as conversas."))
        .finally(() => setLoadingList(false));
    }, filters.search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [filters, filtersReady, loadConversations]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    if (!selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null);
      return;
    }
    setReplyTo(null);
    // Pinta do cache na hora (troca de conversa fica instantânea) e busca
    // do servidor em segundo plano só pra reconciliar.
    const cached = conversationCache.get(selectedId);
    if (cached) {
      setDetail(cached.detail);
      setMessagesCursor(cached.messagesCursor);
    }
    loadDetail(selectedId).catch(() => toast.error("Não deu pra carregar essa conversa."));
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!socket) return;

    const onConnect = () => {
      loadConversations(filters).catch(() => {});
      if (selectedIdRef.current) loadDetail(selectedIdRef.current).catch(() => {});
    };

    const onConversationUpdated = (updated: ConversationSummary) => {
      // Mais recente sempre em cima: a conversa que acabou de receber
      // mensagem sobe pro topo, igual a qualquer mensageiro.
      setConversations((prev) => {
        const rest = prev.filter((item) => item.id !== updated.id);
        return [updated, ...rest].sort(
          (a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime(),
        );
      });
      if (selectedIdRef.current === updated.id) {
        setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
      }
      loadCounts();
    };

    const onMessageCreated = ({
      conversationId,
      message,
    }: {
      conversationId: string;
      message: ConversationMessage;
    }) => {
      if (selectedIdRef.current !== conversationId) return;
      setDetail((prev) => {
        if (!prev || prev.id !== conversationId) return prev;
        // O socket entrega a mesma mensagem que já pode ter entrado pela
        // resposta do POST; a checagem de id evita duplicar.
        if (prev.messages.some((m) => m.id === message.id)) return prev;
        const messages = [...prev.messages, message];
        conversationCache.patchMessages(conversationId, messages);
        return { ...prev, messages };
      });
    };

    const onMessageUpdated = ({
      conversationId,
      message,
    }: {
      conversationId: string;
      message: ConversationMessage;
    }) => {
      if (selectedIdRef.current !== conversationId) return;
      setDetail((prev) =>
        prev
          ? { ...prev, messages: prev.messages.map((m) => (m.id === message.id ? message : m)) }
          : prev,
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
    socket.on("message.updated", onMessageUpdated);
    socket.on("message.status", onMessageStatus);

    return () => {
      socket.off("connect", onConnect);
      socket.off("conversation.updated", onConversationUpdated);
      socket.off("message.created", onMessageCreated);
      socket.off("message.updated", onMessageUpdated);
      socket.off("message.status", onMessageStatus);
    };
  }, [socket, loadConversations, loadDetail, loadCounts, filters]);

  async function handleSend(content: string) {
    if (!selectedId) return;

    // Envio otimista: a mensagem aparece na hora com um tique vazio, do
    // jeito que o WhatsApp faz. Se o servidor confirmar, o evento de tempo
    // real substitui pela versão real; se falhar, ela some e avisamos.
    const optimisticId = `pending-${Date.now()}`;
    const optimistic: ConversationMessage = {
      id: optimisticId,
      conversationId: selectedId,
      senderType: "AGENT",
      senderId: null,
      content,
      messageType: "TEXT",
      metadata: null,
      status: "PENDING",
      reactions: null,
      replyToId: replyTo?.id ?? null,
      replyTo: replyTo
        ? {
            id: replyTo.id,
            content: replyTo.content,
            senderType: replyTo.senderType,
            messageType: replyTo.messageType,
          }
        : null,
      createdAt: new Date().toISOString(),
    };

    const quoted = replyTo?.id;
    setDetail((prev) => (prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev));
    setReplyTo(null);
    setSending(true);

    try {
      await apiFetch(`/conversations/${selectedId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, replyToId: quoted }),
      });
      // A mensagem real chega pelo socket; tirar a otimista aqui evita ela
      // ficar duplicada na tela por um instante.
      setDetail((prev) =>
        prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimisticId) } : prev,
      );
    } catch {
      setDetail((prev) =>
        prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimisticId) } : prev,
      );
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

  async function handleReact(messageId: string, emoji: string) {
    if (!selectedId) return;
    try {
      await apiFetch(`/conversations/${selectedId}/messages/${messageId}/reaction`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      });
    } catch {
      toast.error("Não deu pra reagir.");
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
    // Sem cartão, sem margem, sem título: a tela inteira é o painel, do
    // jeito que o WhatsApp Web faz. O cabeçalho da conversa e a barra de
    // filtros já dizem onde a pessoa está.
    <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden bg-card md:grid-cols-[340px_1fr] xl:grid-cols-[340px_1fr_300px]">
      <div className="hidden min-h-0 flex-col border-r md:flex">
        <InboxFilterBar
          value={filters}
          counts={counts}
          onChange={setFilters}
          action={<SimulateInboundDialog onSimulated={() => loadConversations(filters)} />}
        />
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          liveUnread={unreadCounts}
          loading={loadingList}
          hasMore={Boolean(cursor)}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
          onSelect={setSelectedId}
        />
      </div>
      {/* Remontar ao trocar de conversa zera rascunho e busca — que é o
          esperado: rascunho de uma conversa não pode aparecer na outra. */}
      <ChatPanel
        key={selectedId ?? "vazio"}
        conversation={detail}
        sending={sending}
        replyTo={replyTo}
        hasOlder={Boolean(messagesCursor)}
        onLoadOlder={loadOlderMessages}
        onReply={setReplyTo}
        onCancelReply={() => setReplyTo(null)}
        onReact={handleReact}
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
  );
}
