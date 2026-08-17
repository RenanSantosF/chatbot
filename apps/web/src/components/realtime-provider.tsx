"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Socket } from "socket.io-client";
import { apiFetch } from "@/lib/api-client";
import { connectRealtime } from "@/lib/socket";
import type {
  ConversationMessage,
  ConversationSummary,
  EstadoDoCanalSessao,
} from "@/lib/types";
import { SITE_NAME } from "@/lib/site";

/**
 * O estado do WhatsApp da empresa, empurrado pelo servidor.
 *
 * Vive aqui, e não na tela de configurações, porque a queda da sessão não
 * é assunto de quem está configurando: é de quem está ATENDENDO. Sem isso,
 * o atendente seguia digitando e enviando enquanto as mensagens sumiam no
 * caminho, e a verdade só aparecia se alguém abrisse as configurações.
 */
export interface EstadoDoCanal {
  estado: "CONECTADO" | "AGUARDANDO_QRCODE" | "DESCONECTADO";
  /** Por que caiu, quando caiu. */
  lastError?: string | null;
  /** A imagem do QR code, quando um novo acabou de nascer. */
  qrCode?: string | null;
  /** O código de 8 caracteres, quando o pareamento é por número. */
  pairingCode?: string | null;
  /** Quando esta notícia chegou — é o que faz a tela reagir a repetições. */
  em: number;
}

/**
 * A trazida das conversas do aparelho.
 *
 * Estado separado do da conexão porque os dois andam em ritmos
 * diferentes: a sessão fica de pé num instante, e o histórico leva
 * minutos chegando em lotes. Misturar os dois foi o que produziu um
 * "Conectado" com um giro do lado que ninguém sabia quando parava.
 */
export interface HistoricoDoCanal {
  importando: boolean;
  /** Quantas já vieram. Serve de sinal de vida durante a espera. */
  mensagens: number;
  /**
   * De 0 a 100, contado pelo aparelho.
   *
   * A contagem de mensagens sozinha não diz se falta muito — ela sobe sem
   * teto. É o percentual que transforma a espera em algo que se acompanha.
   */
  progresso: number;
}

interface RealtimeContextValue {
  socket: Socket | null;
  connected: boolean;
  /** Nulo até o servidor dizer alguma coisa. */
  canal: EstadoDoCanal | null;
  /**
   * Corrige o estado do canal a partir de quem acabou de consultá-lo.
   *
   * A faixa de aviso nasce com o estado do login e depois só muda por
   * evento. Quem abre a tela de Configurações consulta o servidor e
   * descobre a verdade ANTES de qualquer evento chegar — sem um caminho
   * de volta, o cartão dizia "Conectado" e a faixa vermelha continuava
   * mandando ler o QR code logo acima dele.
   */
  informarCanal: (estado: Omit<EstadoDoCanal, "em">) => void;
  /** Nulo enquanto não se sabe — canal oficial nunca importa nada. */
  historico: HistoricoDoCanal | null;
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
export function RealtimeProvider({
  canalInicial,
  children,
}: {
  /**
   * O estado do WhatsApp no momento em que a página carregou.
   *
   * Sem ele, `canal` nascia nulo e a faixa de aviso só existia depois que
   * um evento chegasse — o que não acontece pra quem abre o painel com a
   * sessão JÁ caída. A queda tinha ocorrido antes de a aba existir, e o
   * aviso aparecia por acaso, quando calhava de a sessão oscilar com a
   * página aberta.
   */
  canalInicial?: EstadoDoCanalSessao;
  children: React.ReactNode;
}) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(true);
  const [canal, setCanal] = useState<EstadoDoCanal | null>(() =>
    canalInicial
      ? {
          estado: canalInicial.estado,
          lastError: canalInicial.motivo,
          em: Date.now(),
        }
      : null,
  );
  const [historico, setHistorico] = useState<HistoricoDoCanal | null>(
    canalInicial?.historico ?? null,
  );
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

    // O WhatsApp da empresa caiu, voltou, ou tem um QR code novo. Chega
    // por aqui em vez de por consulta periódica porque os três são
    // urgentes: os dois primeiros param o produto inteiro, e o terceiro
    // expira em cerca de um minuto.
    instance.on("canal.estado", (evento: Omit<EstadoDoCanal, "em">) => {
      setCanal({ ...evento, em: Date.now() });
      // Parear recomeça a importação; cair encerra a espera — não há
      // aparelho do outro lado pra mandar lote nenhum.
      setHistorico(
        evento.estado === "CONECTADO"
          ? { importando: true, mensagens: 0, progresso: 0 }
          : { importando: false, mensagens: 0, progresso: 0 },
      );
    });

    /*
     * Os lotes do histórico chegando.
     *
     * É o que substitui o cronômetro de três minutos que existia no
     * navegador. Aquele mentia dos dois lados: dizia "trazendo as
     * conversas" quando não havia importação nenhuma acontecendo, e —
     * numa aba de celular em segundo plano, onde o Chrome congela o
     * temporizador — nunca terminava.
     */
    instance.on(
      "canal.historico",
      (evento: { estado: string; mensagens: number; progresso?: number }) => {
        setHistorico({
          importando: evento.estado === "IMPORTANDO",
          mensagens: evento.mensagens,
          progresso: evento.progresso ?? 0,
        });
      },
    );

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
    document.title = totalUnread > 0 ? `(${totalUnread}) ${SITE_NAME}` : SITE_NAME;
    return () => {
      document.title = SITE_NAME;
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

  const informarCanal = useCallback((estado: Omit<EstadoDoCanal, "em">) => {
    setCanal({ ...estado, em: Date.now() });
  }, []);

  const enableNotifications = useCallback(async () => {
    if (!("Notification" in window)) return;
    setNotifPermission(await Notification.requestPermission());
  }, []);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      socket,
      connected,
      canal,
      informarCanal,
      historico,
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
      canal,
      informarCanal,
      historico,
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
