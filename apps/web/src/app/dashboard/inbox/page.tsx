"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { Socket } from "socket.io-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/components/inbox/chat-panel";
import { ConversationList } from "@/components/inbox/conversation-list";
import { CustomerPanel } from "@/components/inbox/customer-panel";
import { SimulateInboundDialog } from "@/components/inbox/simulate-inbound-dialog";
import { apiFetch } from "@/lib/api-client";
import { connectRealtime } from "@/lib/socket";
import type { ConversationDetail, ConversationSummary } from "@/lib/types";

export default function InboxPage() {
  // Só lida com o momento inicial da tela: um link vindo da página de
  // Clientes ("Abrir conversa") chega com ?c=<id>, então já entra
  // selecionando ela em vez de deixar o usuário procurar de novo.
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("c"));
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(true);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<ConversationSummary[]>([]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUnreadCounts((prev) => {
        if (!prev[selectedId]) return prev;
        const next = { ...prev };
        delete next[selectedId];
        return next;
      });
    }
  }, [selectedId]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotifPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    const totalUnread = Object.values(unreadCounts).reduce((sum, n) => sum + n, 0);
    document.title = totalUnread > 0 ? `(${totalUnread}) Clara` : "Clara";
    return () => {
      document.title = "Clara";
    };
  }, [unreadCounts]);

  async function handleEnableNotifications() {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    setNotifPermission(permission);
  }

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
    const getToken = async () => {
      const { token } = await apiFetch<{ token: string }>("/auth/socket-token");
      return token;
    };

    const socket = connectRealtime(getToken);
    socketRef.current = socket;

    // Dispara em toda conexão, inclusive reconexões depois de queda de rede
    // ou aba em segundo plano — sem isso, o painel fica com dados velhos
    // depois de voltar de uma queda, mesmo com o socket reconectado.
    socket.on("connect", () => {
      setConnected(true);
      loadConversations().catch(() => toast.error("Não deu pra atualizar as conversas."));
      if (selectedIdRef.current) {
        loadDetail(selectedIdRef.current).catch(() => {});
      }
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

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
          return;
        }

        if (message.senderType !== "CUSTOMER") return;

        setUnreadCounts((prev) => ({ ...prev, [conversationId]: (prev[conversationId] ?? 0) + 1 }));

        if (typeof document !== "undefined" && document.hidden && Notification.permission === "granted") {
          const customerName =
            conversationsRef.current.find((c) => c.id === conversationId)?.customer.name ?? "Novo cliente";
          const notification = new Notification(customerName, { body: message.content, tag: conversationId });
          notification.onclick = () => {
            window.focus();
            setSelectedId(conversationId);
            notification.close();
          };
        }
      },
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [loadConversations, loadDetail]);

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
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
            <p className="text-sm text-muted-foreground">Conversas em tempo real.</p>
          </div>
          {!connected ? (
            <Badge variant="outline" className="animate-pulse text-amber-600">
              Reconectando...
            </Badge>
          ) : null}
          {notifPermission === "default" ? (
            <Button size="sm" variant="outline" onClick={handleEnableNotifications}>
              Ativar notificações
            </Button>
          ) : null}
          {notifPermission === "denied" ? (
            <span className="text-xs text-muted-foreground">Notificações bloqueadas pelo navegador</span>
          ) : null}
        </div>
        <SimulateInboundDialog onSimulated={loadConversations} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr_280px] overflow-hidden rounded-lg border">
        <div className="overflow-y-auto border-r">
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            unreadCounts={unreadCounts}
            onSelect={setSelectedId}
          />
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
