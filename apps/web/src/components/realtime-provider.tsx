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
import { resumoDaMensagem } from "@/lib/mensagem";
import { cancelarAvisos, estaInscrito, inscreverParaAvisos } from "@/lib/push";

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
  /**
   * Quando esta espera começou.
   *
   * O servidor desiste de esperar depois de alguns minutos, mas essa
   * conta só é refeita quando a página carrega. No navegador a espera era
   * re-armada a cada aviso de conexão — e como a sessão reconecta várias
   * vezes por hora, o "trazendo as conversas" girava pra sempre, mesmo
   * sem importação nenhuma acontecendo.
   */
  desde: number;
}

/** Até quando dizer que as conversas estão vindo, sem notícia de lote nenhum. */
const PACIENCIA_MS = 10 * 60_000;

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
  /**
   * Este aparelho está inscrito pra receber aviso com o painel FECHADO.
   *
   * Diferente de `notifPermission === "granted"`, que só diz que o
   * navegador deixa avisar enquanto a aba existe. A inscrição é o que
   * atravessa o fechar da janela, e ela pode faltar mesmo com a permissão
   * dada — servidor sem VAPID, dados do site limpos, chave trocada. Sem
   * separar as duas, a tela dizia "ativado" pra quem não ia receber nada.
   */
  avisosNesteAparelho: boolean;
  /** Desliga o aviso com o painel fechado, sem mexer na permissão. */
  disableNotifications: () => Promise<void>;
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
    // Função de inicialização: `Date.now()` no corpo do componente seria
    // lido a cada renderização, e a regra de pureza barra — com razão.
    () => (canalInicial?.historico ? { ...canalInicial.historico, desde: Date.now() } : null),
  );

  /*
   * A espera tem fim mesmo sem notícia.
   *
   * Sem isto, uma importação que nunca manda o primeiro lote — porque o
   * aparelho não tinha o que mandar, ou porque o evento se perdeu — deixa
   * o aviso girando indefinidamente. Girar pra sempre é pior que dizer
   * que acabou: quem olha conclui que o sistema travou.
   */
  useEffect(() => {
    if (!historico?.importando) return;

    const restante = PACIENCIA_MS - (Date.now() - historico.desde);
    const timer = setTimeout(
      () => setHistorico((atual) => (atual ? { ...atual, importando: false } : atual)),
      Math.max(0, restante),
    );
    return () => clearTimeout(timer);
  }, [historico?.importando, historico?.desde]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null);
  /*
   * Este aparelho recebe aviso pelo sistema (Web Push)?
   *
   * Num ref, e não em estado: quem lê isto é o ouvinte do socket, que é
   * montado UMA vez. Em estado, ele leria para sempre o valor do primeiro
   * render — falso — e o aviso da página continuaria saindo mesmo depois
   * de o push começar a funcionar.
   */
  const temPushRef = useRef(false);
  /*
   * O MESMO valor, em estado, pra tela poder desenhar.
   *
   * O ref existe pelo motivo acima e não serve pra render — quem lê um ref
   * não é avisado quando ele muda. Manter os dois é feio, e a alternativa
   * era pior: sem estado, a tela de avisos não tinha como dizer se este
   * aparelho está inscrito, que é a única informação que ela precisa dar.
   */
  const [avisosNesteAparelho, setAvisosNesteAparelho] = useState(false);
  const anotarPush = useCallback((ativo: boolean) => {
    temPushRef.current = ativo;
    setAvisosNesteAparelho(ativo);
  }, []);
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
    if (typeof window === "undefined" || !("Notification" in window)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotifPermission(Notification.permission);

    /*
     * Quem já autorizou volta inscrito, sem precisar autorizar de novo.
     *
     * A inscrição não sobrevive sozinha a tudo: o navegador pode rodar a
     * chave, a pessoa pode limpar os dados do site, e o servidor pode ter
     * trocado o par VAPID. Refazer a cada abertura do painel é barato (um
     * GET e, quase sempre, nenhuma escrita) e é o que evita o pior caso —
     * alguém achar que está sendo avisado e não estar.
     */
    if (Notification.permission === "granted") {
      void inscreverParaAvisos().then(anotarPush);
    } else {
      void estaInscrito().then(anotarPush);
    }
  }, [anotarPush]);

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
          ? // Só re-arma se não havia espera em andamento: reconectar não
            // recomeça importação nenhuma, e tratar como se recomeçasse é
            // o que fazia o aviso não terminar nunca.
            (atual) =>
              atual?.importando
                ? atual
                : { importando: true, mensagens: 0, progresso: 0, desde: Date.now() }
          : { importando: false, mensagens: 0, progresso: 0, desde: Date.now() },
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
        setHistorico((atual) => ({
          importando: evento.estado === "IMPORTANDO",
          mensagens: evento.mensagens,
          progresso: evento.progresso ?? 0,
          // Lote que chega renova a paciência: há importação de verdade
          // acontecendo, e ela pode demorar mais que a janela.
          desde: evento.estado === "IMPORTANDO" ? Date.now() : (atual?.desde ?? Date.now()),
        }));
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

        /*
         * Quando avisar: sempre que o painel não estiver NA MÃO da pessoa.
         *
         * `document.hidden` sozinho não era isso. Ele só é verdadeiro com a
         * aba trocada ou a janela minimizada — quem estava com o navegador
         * aberto atrás da planilha, que é a maior parte do expediente de
         * quem atende, continuava com a aba "visível" e não recebia aviso
         * nenhum. Era o "não funciona 100%": funcionava exatamente nos
         * casos em que a pessoa já ia ver.
         *
         * `hasFocus()` cobre esse buraco: a janela existe na tela, mas o
         * teclado está em outro programa.
         */
        const foraDeVista =
          typeof document !== "undefined" &&
          (document.hidden || !document.hasFocus());

        /*
         * Com Web Push ativo, quem avisa é o service worker.
         *
         * Os dois caminhos desenham a MESMA notificação, e deixar os dois
         * ligados faria a pessoa receber o aviso em dobro a cada mensagem.
         * O do sistema é estritamente melhor — funciona com o painel
         * fechado —, então ele ganha, e este aqui vira a reserva de quem
         * não tem push (navegador sem suporte, servidor sem VAPID).
         */
        if (foraDeVista && !temPushRef.current && Notification.permission === "granted") {
          const notification = new Notification(namesRef.current[conversationId] ?? "Nova mensagem", {
            // Anexo tem `content` vazio, e um balão de notificação sem
            // texto parece defeito. O mesmo resumo que a lista de
            // conversas usa ("Imagem", "Áudio") vale aqui.
            body: resumoDaMensagem(message.content, message.messageType),
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
    const permissao = await Notification.requestPermission();
    setNotifPermission(permissao);

    // A inscrição vem logo depois da autorização, e não numa tela de
    // configuração à parte: quem acabou de autorizar espera ser avisado a
    // partir de agora, inclusive com o painel fechado.
    if (permissao === "granted") {
      anotarPush(await inscreverParaAvisos());
    }
  }, [anotarPush]);

  /**
   * Desliga o aviso com o painel fechado.
   *
   * Cancela a inscrição e apaga o registro no servidor, mas NÃO mexe na
   * permissão do navegador — nem daria: só a pessoa revoga isso, nas
   * configurações do site. É a diferença entre "não quero mais ser
   * avisado" e "não confio neste site", e só a primeira é nossa.
   */
  const disableNotifications = useCallback(async () => {
    await cancelarAvisos();
    anotarPush(false);
  }, [anotarPush]);

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
      avisosNesteAparelho,
      disableNotifications,
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
      avisosNesteAparelho,
      disableNotifications,
    ],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
