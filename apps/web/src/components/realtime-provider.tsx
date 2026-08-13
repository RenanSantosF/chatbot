"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Socket } from "socket.io-client";
import { apiFetch } from "@/lib/api-client";
import { connectRealtime } from "@/lib/socket";
import type { ConversationMessage, ConversationSummary } from "@/lib/types";

interface RealtimeContextValue {
  socket: Socket | null;
  connected: boolean;
  unreadCounts: Record<string, number>;
  totalUnread: number;
  clearUnread: (conversationId: string) => void;
  /** O Inbox informa qual conversa está aberta pra ela não contar como não lida. */
  setActiveConversationId: (id: string | null) => void;
  notifPermission: NotificationPermission | null;
  enableNotifications: () => Promise<void>;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function useRealtime(): RealtimeContextValue {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error("useRealtime precisa estar dentro de <RealtimeProvider>.");
  }
  return context;
}

/**
 * Uma conexão de tempo real por sessão do painel, viva em todas as telas —
 * não só no Inbox. É o que permite o contador no menu e a notificação do
 * navegador continuarem funcionando com o usuário em Clientes, Relatórios,
 * etc. As telas que precisam reagir a eventos específicos pegam o socket
 * daqui e escutam por conta própria.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(true);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null);
  const activeConversationRef = useRef<string | null>(null);
  const namesRef = useRef<Record<string, string>>({});
  const router = useRouter();

  // O router entra por ref pra ele não virar dependência do efeito de
  // conexão: se a referência mudasse entre renders, o socket seria
  // derrubado e reaberto sem necessidade.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotifPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    const getToken = async () => {
      const { token } = await apiFetch<{ token: string }>("/auth/socket-token");
      return token;
    };

    const instance = connectRealtime(getToken);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(instance);

    instance.on("connect", () => setConnected(true));
    instance.on("disconnect", () => setConnected(false));

    // Guarda o nome do cliente de cada conversa pra a notificação ter um
    // título decente sem precisar buscar na API na hora que chega.
    instance.on("conversation.updated", (conversation: ConversationSummary) => {
      namesRef.current[conversation.id] = conversation.customer.name;

      // Quem abriu a conversa zerou as não lidas NO SERVIDOR — e o servidor
      // avisa todo mundo. Sem apagar o contador local aqui, a conversa
      // continuava em negrito com bolinha vermelha na tela dos outros
      // atendentes mesmo depois de um colega já ter lido e respondido:
      // duas pessoas correndo pro mesmo atendimento.
      if (conversation.unreadCount === 0) {
        setUnreadCounts((prev) => {
          if (!prev[conversation.id]) return prev;
          const next = { ...prev };
          delete next[conversation.id];
          return next;
        });
      }
    });

    instance.on(
      "message.created",
      ({ conversationId, message }: { conversationId: string; message: ConversationMessage }) => {
        if (message.senderType !== "CUSTOMER") return;
        if (activeConversationRef.current === conversationId) return;

        setUnreadCounts((prev) => ({
          ...prev,
          [conversationId]: (prev[conversationId] ?? 0) + 1,
        }));

        if (typeof document !== "undefined" && document.hidden && Notification.permission === "granted") {
          const notification = new Notification(namesRef.current[conversationId] ?? "Nova mensagem", {
            body: message.content,
            tag: conversationId,
          });
          notification.onclick = () => {
            window.focus();
            routerRef.current.push(`/dashboard/inbox?c=${conversationId}`);
            notification.close();
          };
        }
      },
    );

    return () => {
      instance.disconnect();
    };
  }, []);

  const totalUnread = useMemo(
    () => Object.values(unreadCounts).reduce((sum, count) => sum + count, 0),
    [unreadCounts],
  );

  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) Clara` : "Clara";
    return () => {
      document.title = "Clara";
    };
  }, [totalUnread]);

  const clearUnread = useCallback((conversationId: string) => {
    setUnreadCounts((prev) => {
      if (!prev[conversationId]) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  }, []);

  const setActiveConversationId = useCallback(
    (id: string | null) => {
      activeConversationRef.current = id;
      if (id) clearUnread(id);
    },
    [clearUnread],
  );

  const enableNotifications = useCallback(async () => {
    if (!("Notification" in window)) return;
    setNotifPermission(await Notification.requestPermission());
  }, []);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      socket,
      connected,
      unreadCounts,
      totalUnread,
      clearUnread,
      setActiveConversationId,
      notifPermission,
      enableNotifications,
    }),
    [
      socket,
      connected,
      unreadCounts,
      totalUnread,
      clearUnread,
      setActiveConversationId,
      notifPermission,
      enableNotifications,
    ],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
