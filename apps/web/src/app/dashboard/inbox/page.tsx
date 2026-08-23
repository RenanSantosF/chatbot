"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StartConversationDialog } from "@/components/customers/start-conversation-dialog";
import { ChatPanel } from "@/components/inbox/chat-panel";
import { ConversationList } from "@/components/inbox/conversation-list";
import { CustomerPanel } from "@/components/inbox/customer-panel";
import {
  DEFAULT_FILTERS,
  InboxFilterBar,
  type FilterCounts,
  type InboxFilters,
} from "@/components/inbox/inbox-filters";
import { useRealtime } from "@/components/realtime-provider";
import { useSession } from "@/components/session-provider";
import type { Relogio } from "@/lib/espera";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { conversationCache } from "@/lib/conversation-cache";
import { usePersistedState } from "@/lib/use-persisted-state";
import type {
  ConversationDetail,
  ConversationMessage,
  ConversationPriority,
  ConversationSummary,
  InboxSettings,
  MessageStatus,
} from "@/lib/types";
import { TranscricaoDeAudioProvider } from "@/components/inbox/transcricao-de-audio";

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Prefixo do id do balão que ainda não existe no servidor.
 *
 * É por ele que o evento de tempo real reconhece "esta é a versão real
 * daquela que acabei de pintar" e troca no lugar, em vez de somar uma
 * linha e deixar a outra sumir depois.
 */
const ID_OTIMISTA = "pending-";

const EMPTY_COUNTS: FilterCounts = {
  total: 0,
  unread: 0,
  mine: 0,
  unassigned: 0,
  comIa: 0,
  esperando: 0,
  pendentes: 0,
  aguardando: 0,
  resolvidas: 0,
  status: {},
  priority: {},
};

/**
 * O MESMO recorte alimenta a lista e os contadores.
 *
 * Montar a consulta em dois lugares foi o que fez os números do cabeçalho
 * discordarem da lista embaixo: "Pendentes 1" com "Minhas 5". Uma função
 * só, dois destinos.
 */
function buildQuery(
  filters: InboxFilters,
  cursor?: string | null,
  caminho = "/conversations",
): string {
  const params = new URLSearchParams();
  if (filters.grupo !== "ALL") params.set("statusGroup", filters.grupo);
  if (filters.status !== "ALL") params.set("status", filters.status);
  if (filters.priority !== "ALL") params.set("priority", filters.priority);
  // Interruptores independentes: dá pra pedir "minhas E não lidas", coisa
  // que a versão anterior (opções exclusivas) não permitia.
  if (filters.mine) params.set("mine", "true");
  if (filters.unread) params.set("unread", "true");
  if (filters.unassigned) params.set("unassigned", "true");
  if (filters.comIa) params.set("comIa", "true");
  if (filters.waiting) params.set("waiting", "true");
  if (filters.ordem !== "RECENTE") params.set("ordem", filters.ordem);
  // A etiqueta é recorte, não faceta: vai junto na contagem também, senão
  // o cabeçalho contaria fora do que a lista está mostrando.
  if (filters.tagId) params.set("tagId", filters.tagId);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `${caminho}?${query}` : caminho;
}

/**
 * O recorte atual mostra conversa já resolvida?
 *
 * É o que decide se resolver uma conversa a tira da lista — e, portanto,
 * se vale animá-la saindo. Estado escolhido à mão ganha do grupo porque é
 * assim que a barra de filtros funciona: escolher um zera o outro.
 */
function mostraResolvidas(filtros: InboxFilters): boolean {
  if (filtros.status !== "ALL") {
    return filtros.status === "RESOLVED" || filtros.status === "CLOSED";
  }
  return filtros.grupo === "ALL" || filtros.grupo === "DONE";
}

export default function InboxPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useSession();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /**
   * A conversa resolvida que está deslizando pra fora da lista.
   *
   * Existe só entre o "resolvido" do servidor e a lista voltar sem ela —
   * ver `handleResolve` e a animação em globals.css.
   */
  const [saindoDaLista, setSaindoDaLista] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("c"));
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messagesCursor, setMessagesCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState<FilterCounts>(EMPTY_COUNTS);
  const [sending, setSending] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [replyTo, setReplyTo] = useState<ConversationMessage | null>(null);
  // Vem das configurações da empresa. Otimista em true: o padrão do sistema
  // é liberar, e travar o compositor por um instante enquanto a resposta não
  // chega seria pior que o contrário.
  const [podeEnviarEncerrada, setPodeEnviarEncerrada] = useState(true);
  const [transcricao, setTranscricao] =
    useState<InboxSettings["transcricaoDeAudio"]>("SOB_DEMANDA");
  /**
   * Expediente e fuso da empresa.
   *
   * Buscado uma vez e passado pra lista: é o que faz o selo de espera parar
   * de gritar de madrugada. Enquanto não chega, o padrão "sem expediente"
   * mantém o comportamento anterior — alarme sempre ligado, que é o lado
   * seguro pra errar.
   */
  const [relogio, setRelogio] = useState<Relogio>({ expediente: null, fuso: "America/Sao_Paulo" });

  // Filtros sobrevivem a recarregar e a sair da tela — quem trabalha o dia
  // todo no Inbox não quer reconfigurar a cada volta.
  const [filters, setFilters, filtersReady] = usePersistedState<InboxFilters>(
    "inbox-filters",
    DEFAULT_FILTERS,
  );

  const selectedIdRef = useRef<string | null>(null);
  const { socket, unreadCounts, clearUnread, setActiveConversationId } = useRealtime();

  /*
   * O `?c=` da URL abre a conversa TODA VEZ que muda, não só na primeira.
   *
   * O estado acima nasce de um inicializador preguiçoso, que por definição
   * roda uma vez só. Isso bastava pra quem chegava de fora com o link
   * pronto, e não bastava pro caso que mais importa: clicar na notificação
   * do navegador com o Inbox JÁ aberto. Ali o `router.push` troca a
   * querystring sem remontar a página — a barra de endereço mudava, a
   * conversa não abria, e a notificação parecia não fazer nada.
   *
   * Só entra quando o valor é diferente do que já está selecionado: sem
   * essa comparação, clicar numa conversa da lista (que não mexe na URL)
   * seria desfeito no render seguinte, e a tela voltaria pra conversa da
   * notificação sozinha.
   */
  const conversaDaUrl = searchParams.get("c");
  useEffect(() => {
    if (!conversaDaUrl || conversaDaUrl === selectedIdRef.current) return;
    setSelectedId(conversaDaUrl);
  }, [conversaDaUrl]);

  /**
   * Abrir uma conversa também escreve na URL.
   *
   * Não é enfeite de endereço: sem isso o `?c=` congelava no valor com que
   * a página nasceu, e a notificação da conversa que estava lá parava de
   * funcionar — o `router.push` escreveria o mesmo valor que já estava
   * escrito, nada mudaria, e o efeito acima não teria por que rodar. Com a
   * URL acompanhando, ela sempre reflete o que está aberto, e qualquer
   * push que aponte pra outra conversa é diferente por construção.
   *
   * `replace` e não `push`: cada conversa aberta virando uma entrada no
   * histórico faria o botão Voltar caminhar por vinte atendimentos antes
   * de sair do Inbox.
   */
  const abrirConversa = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      router.replace(id ? `/dashboard/inbox?c=${id}` : "/dashboard/inbox", {
        scroll: false,
      });
    },
    [router],
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
    setActiveConversationId(selectedId);
    return () => setActiveConversationId(null);
  }, [selectedId, setActiveConversationId]);

  /**
   * Os filtros num ref, além do estado.
   *
   * O socket precisa deles pra recarregar depois de um evento, mas assinar
   * o socket de novo a cada mudança de filtro é caro: desliga e religa
   * cinco ouvintes, e o Inbox fica lento justamente quando a pessoa está
   * mexendo na barra. Com o ref, o efeito do socket é montado uma vez só.
   */
  const filtersRef = useRef(filters);
  // Atualizado num efeito, não durante a renderização: escrever em ref no
  // corpo do componente é o tipo de coisa que funciona até o React
  // renderizar duas vezes.
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const loadCounts = useCallback((current: InboxFilters = filtersRef.current) => {
    apiFetch<FilterCounts>(buildQuery(current, null, "/conversations/counts"))
      .then(setCounts)
      .catch(() => {});
  }, []);

  /**
   * Recontagem agrupada.
   *
   * Cada `conversation.updated` pedia os contadores de novo, e cada pedido
   * são nove consultas no banco. Numa conversa movimentada — ou logo depois
   * de responder, quando chegam eventos em rajada — a tela disparava
   * dezenas de recontagens em segundos, e era isso que deixava o Inbox
   * pesado conforme se trabalha nele. Uma no fim da rajada diz a mesma
   * coisa.
   */
  const contagemAgendada = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agendarContagem = useCallback(() => {
    if (contagemAgendada.current) clearTimeout(contagemAgendada.current);
    contagemAgendada.current = setTimeout(() => loadCounts(), 400);
  }, [loadCounts]);

  useEffect(
    () => () => {
      if (contagemAgendada.current) clearTimeout(contagemAgendada.current);
    },
    [],
  );

  /**
   * Só a resposta do pedido MAIS RECENTE vale.
   *
   * Trocando de filtro rápido, o servidor responde fora de ordem e a lista
   * assentava no resultado do filtro anterior — a tela mostrava um recorte
   * que já não era o selecionado, e parecia que o clique não pegou.
   */
  const pedidoDaLista = useRef(0);

  /**
   * Busca a lista, e é ELA quem apaga o "carregando".
   *
   * Antes o `setLoadingList(false)` morava num `.finally` no efeito que
   * chamava esta função, e essa separação produzia o vazio que piscava:
   * quando duas buscas se cruzavam — abrir a tela já dispara duas, uma com
   * os filtros padrão e outra com os guardados —, a primeira a responder
   * caía no `return` de resposta velha logo acima SEM gravar nada, e ainda
   * assim o `finally` dela desligava o carregando. A tela ficava com
   * `loading` falso e a lista vazia: "Nenhuma conversa aqui", até a
   * segunda resposta chegar um segundo depois.
   *
   * Agora quem desliga é a resposta que VENCEU, e ela desliga junto de
   * gravar os dados — no mesmo lote de renderização, sem intervalo em que
   * a tela possa dizer que não há nada.
   */
  const loadConversations = useCallback(async (current: InboxFilters) => {
    const meu = ++pedidoDaLista.current;
    try {
      const page = await apiFetch<Page<ConversationSummary>>(buildQuery(current));
      if (meu !== pedidoDaLista.current) return;
      setConversations(page.items);
      setCursor(page.nextCursor);
      setLoadingList(false);
    } catch (erro) {
      // Falhar também tira o esqueleto: senão a tela gira pra sempre e
      // ninguém entende que a busca acabou (mal).
      if (meu === pedidoDaLista.current) setLoadingList(false);
      throw erro;
    }
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
      // Abrir não zera mais nada: quem zera é `marcarLida`, quando o fim da
      // conversa aparece na tela. O contador segue intacto até lá porque é
      // dele que sai a tarja de "N mensagens não lidas".
    },
    [],
  );

  /**
   * O fim da conversa apareceu pra quem está olhando. Só então ela conta
   * como lida — aqui, na lista, no menu lateral e no tique azul do cliente.
   */
  const marcarLida = useCallback(
    (id: string) => {
      apiFetch(`/conversations/${id}/read`, { method: "POST" })
        .then(() => {
          clearUnread(id);
          setConversations((prev) =>
            prev.map((item) => (item.id === id ? { ...item, unreadCount: 0 } : item)),
          );
          agendarContagem();
        })
        .catch(() => {});
    },
    [clearUnread, agendarContagem],
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
      // Lista e contadores saem juntos, do mesmo recorte: é o que garante
      // que o número no botão e o que aparece embaixo dele falem da mesma
      // coisa.
      loadCounts(filters);
      loadConversations(filters).catch(() =>
        toast.error("Não deu pra carregar as conversas."),
      );
    }, filters.search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [filters, filtersReady, loadConversations, loadCounts]);

  useEffect(() => {
    // Atendente não tem permissão de LER as configurações de atendimento, e
    // é justamente ele quem mais usa o compositor. A falha silenciosa
    // mantém o padrão liberado em vez de travar a tela de quem não pode
    // consultar o ajuste.
    apiFetch<{
      allowSendWhenResolved?: boolean;
      businessHours?: Relogio["expediente"];
      timezone?: string;
      transcricaoDeAudio?: InboxSettings["transcricaoDeAudio"];
    }>("/inbox-settings")
      .then((s) => {
        setPodeEnviarEncerrada(s.allowSendWhenResolved !== false);
        setRelogio({
          expediente: s.businessHours ?? null,
          fuso: s.timezone ?? "America/Sao_Paulo",
        });
        if (s.transcricaoDeAudio) setTranscricao(s.transcricaoDeAudio);
      })
      .catch(() => setPodeEnviarEncerrada(true));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null);
      return;
    }
    setReplyTo(null);
    // Pinta do cache na hora (troca de conversa fica instantânea) e busca
    // do servidor em segundo plano só pra reconciliar.
    //
    // O `setDetail(null)` antes é o que mata o piscar: sem ele, o React
    // mantinha a conversa ANTERIOR na tela durante o quadro em que a nova
    // ainda não chegou — dava a impressão de a conversa errada abrir e só
    // depois trocar. Melhor um instante vazio que a conversa errada.
    const cached = conversationCache.get(selectedId);
    setDetail(cached ? cached.detail : null);
    setMessagesCursor(cached ? cached.messagesCursor : null);
    loadDetail(selectedId).catch(() => toast.error("Não deu pra carregar essa conversa."));
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!socket) return;

    const onConnect = () => {
      loadConversations(filtersRef.current).catch(() => {});
      if (selectedIdRef.current) loadDetail(selectedIdRef.current).catch(() => {});
    };

    const onConversationUpdated = (updated: ConversationSummary) => {
      // Mais recente sempre em cima: a conversa que acabou de receber
      // mensagem sobe pro topo, igual a qualquer mensageiro. A troca de
      // posição vai numa view transition — sem ela a lista "pisca" e quem
      // está lendo perde de vista onde estava. Onde o navegador não tem a
      // API, o estado muda igual, só que sem o deslizamento.
      const reorder = () =>
        setConversations((prev) => {
          const rest = prev.filter((item) => item.id !== updated.id);
          // Na fila quem manda é o tempo de espera, e ele NÃO sobe com
          // mensagem nova — pelo contrário: quem acabou de cobrar continua
          // esperando desde a primeira vez. Reordenar por recência aqui
          // desfaria a fila a cada evento.
          if (filtersRef.current.ordem === "ESPERA") {
            return [updated, ...rest].sort((a, b) => {
              const esperaA = a.waitingSince ? new Date(a.waitingSince).getTime() : Infinity;
              const esperaB = b.waitingSince ? new Date(b.waitingSince).getTime() : Infinity;
              return esperaA - esperaB;
            });
          }
          return [updated, ...rest].sort(
            (a, b) =>
              new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime(),
          );
        });

      if (typeof document.startViewTransition === "function") {
        document.startViewTransition(() => flushSync(reorder));
      } else {
        reorder();
      }
      if (selectedIdRef.current === updated.id) {
        setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
      }
      agendarContagem();
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

        // Se esta é a versão real de uma mensagem que acabamos de mandar,
        // ela SUBSTITUI o balão otimista em vez de entrar depois dele.
        //
        // Anexar criava uma linha a mais por um instante — a otimista
        // continuava lá até a resposta do POST chegar e removê-la. Era a
        // piscada de "aparece uma segunda e some": o balão certo já estava
        // na tela, só que acompanhado.
        const otimista = prev.messages.findIndex(
          (m) =>
            m.id.startsWith(ID_OTIMISTA) &&
            m.senderType === message.senderType &&
            m.content === message.content,
        );

        const messages =
          otimista >= 0
            ? prev.messages.map((m, i) =>
                i === otimista
                  ? { ...message, clientKey: prev.messages[otimista].clientKey }
                  : m,
              )
            : [...prev.messages, message];

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

    /**
     * O áudio virou texto — pode ter sido a IA, o automático ou o botão de
     * outra pessoa da equipe. Chega por evento porque nenhum dos três
     * acontece dentro do clique de quem está com a conversa aberta.
     */
    const onMessageTranscrita = ({
      conversationId,
      messageId,
      transcricao,
    }: {
      conversationId: string;
      messageId: string;
      transcricao: string;
    }) => {
      if (selectedIdRef.current !== conversationId) return;
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === messageId ? { ...m, transcricao } : m,
              ),
            }
          : prev,
      );
    };

    socket.on("connect", onConnect);
    socket.on("conversation.updated", onConversationUpdated);
    socket.on("message.created", onMessageCreated);
    socket.on("message.updated", onMessageUpdated);
    socket.on("message.status", onMessageStatus);
    socket.on("message.transcrita", onMessageTranscrita);

    return () => {
      socket.off("connect", onConnect);
      socket.off("conversation.updated", onConversationUpdated);
      socket.off("message.created", onMessageCreated);
      socket.off("message.updated", onMessageUpdated);
      socket.off("message.status", onMessageStatus);
      socket.off("message.transcrita", onMessageTranscrita);
    };
    // Sem `filters` nas dependências: os ouvintes leem o recorte atual
    // pelo ref, e assim o efeito é montado uma vez só em vez de desligar e
    // religar cinco ouvintes a cada clique na barra de filtros.
  }, [socket, loadConversations, loadDetail, agendarContagem]);

  /** Mesma classificação que o servidor faz, só que antes da viagem. */
  function tipoDoArquivo(file: File): ConversationMessage["messageType"] {
    if (file.type.startsWith("image/")) return "IMAGE";
    if (file.type.startsWith("audio/")) return "AUDIO";
    if (file.type.startsWith("video/")) return "VIDEO";
    return "DOCUMENT";
  }

  async function handleSend(content: string) {
    if (!selectedId) return;

    // Envio otimista: a mensagem aparece na hora com um tique vazio, do
    // jeito que o WhatsApp faz. Se o servidor confirmar, o evento de tempo
    // real substitui pela versão real; se falhar, ela some e avisamos.
    const optimisticId = `${ID_OTIMISTA}${Date.now()}`;

    // A empresa mostra o nome de quem respondeu no balão? Em vez de buscar
    // a configuração (que atendente não tem permissão de ler), a resposta
    // está na própria conversa: se as mensagens de atendente já carregam
    // nome, o ajuste está ligado. Sem isso o balão otimista nasce sem nome
    // e ganha um quando a versão do servidor chega — o mesmo salto visual
    // que a troca abaixo existe pra evitar.
    const mostraNome = Boolean(
      detail?.messages.some((m) => m.senderType === "AGENT" && m.senderName),
    );

    const optimistic: ConversationMessage = {
      id: optimisticId,
      // A chave de tela nasce aqui e acompanha a mensagem até o fim: é ela
      // que impede o balão de ser remontado (e reanimado) quando o id
      // provisório der lugar ao do servidor.
      clientKey: optimisticId,
      conversationId: selectedId,
      senderType: "AGENT",
      senderId: null,
      senderName: mostraNome ? user.name : null,
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
      const salva = await apiFetch<ConversationMessage>(
        `/conversations/${selectedId}/messages`,
        { method: "POST", body: JSON.stringify({ content, replyToId: quoted }) },
      );
      // TROCA a otimista pela real, no lugar. Antes ela era removida e a
      // versão do servidor entrava depois, pelo socket — duas operações
      // separadas, e entre elas a mensagem sumia da tela. Era isso o
      // "pisca duas vezes": o balão aparecia, sumia, e voltava com o nome
      // de quem respondeu em cima (que só a versão do servidor tem).
      setDetail((prev) => {
        if (!prev) return prev;

        // O socket pode ter chegado ANTES desta resposta — e chega mesmo,
        // sempre que o envio demora um pouco a mais, que é justamente o
        // caso de responder numa conversa encerrada (o servidor ainda
        // reabre o atendimento e registra a nota antes de devolver).
        //
        // Quando isso acontece, a mensagem de verdade já está na lista.
        // Trocar a otimista por ela criaria DUAS linhas com o mesmo id:
        // a do socket, com o nome de quem respondeu, e esta, sem. Era a
        // duplicata que aparecia no painel enquanto o cliente recebia uma
        // mensagem só. Aqui a otimista é só descartada.
        const jaChegouPeloSocket = prev.messages.some((m) => m.id === salva.id);
        const messages = jaChegouPeloSocket
          ? prev.messages.filter((m) => m.id !== optimisticId)
          : prev.messages.map((m) =>
              m.id === optimisticId ? { ...salva, clientKey: optimisticId } : m,
            );

        return { ...prev, messages };
      });
    } catch {
      setDetail((prev) =>
        prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimisticId) } : prev,
      );
      toast.error("Não deu pra enviar a mensagem.");
    } finally {
      setSending(false);
    }
  }

  async function handleSendFile(file: File, caption?: string) {
    if (!selectedId) return;

    /*
     * Anexo e áudio também entram na hora.
     *
     * Só o texto tinha balão otimista, e a diferença aparecia justamente
     * onde ela dói mais: subir um arquivo leva SEGUNDOS. Quem gravava um
     * áudio via a tela não mudar nada por um tempo longo e ficava sem
     * saber se enviou, se falhou ou se o clique nem pegou — a ponto de
     * gravar de novo.
     *
     * O balão nasce com o arquivo local, então a prévia da imagem e a
     * duração do áudio já aparecem antes de qualquer viagem à rede. Quem
     * troca pela versão de verdade é o evento de tempo real, como no
     * texto.
     */
    const optimisticId = `${ID_OTIMISTA}${Date.now()}`;
    const optimistic: ConversationMessage = {
      id: optimisticId,
      clientKey: optimisticId,
      conversationId: selectedId,
      senderType: "AGENT",
      senderId: null,
      senderName: null,
      content: caption ?? "",
      messageType: tipoDoArquivo(file),
      // `previaLocal` é o endereço do arquivo AQUI, que a tela usa
      // enquanto o servidor não devolve o dele. Some junto com o balão.
      metadata: {
        fileName: file.name,
        mimeType: file.type,
        previaLocal: URL.createObjectURL(file),
      } as ConversationMessage["metadata"],
      status: "PENDING",
      reactions: null,
      replyToId: null,
      replyTo: null,
      createdAt: new Date().toISOString(),
    };

    setDetail((prev) => (prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev));

    // Sem travar o compositor: o upload pode levar segundos e prender o
    // botão de enviar fazia a tela parecer congelada. O andamento aparece
    // na conversa, e a pessoa já pode escrever a próxima mensagem.
    try {
      const body = new FormData();
      body.append("file", file);
      if (caption) body.append("caption", caption);
      const salva = await apiFetch<ConversationMessage>(
        `/conversations/${selectedId}/attachments`,
        { method: "POST", body },
      );

      setDetail((prev) => {
        if (!prev) return prev;
        const jaChegouPeloSocket = prev.messages.some((m) => m.id === salva?.id);
        const messages =
          jaChegouPeloSocket || !salva?.id
            ? prev.messages.filter((m) => m.id !== optimisticId)
            : prev.messages.map((m) =>
                m.id === optimisticId ? { ...salva, clientKey: optimisticId } : m,
              );
        return { ...prev, messages };
      });
    } catch {
      setDetail((prev) =>
        prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimisticId) } : prev,
      );
      toast.error("Não deu pra enviar o arquivo.");
    } finally {
      URL.revokeObjectURL(optimistic.metadata?.previaLocal as string);
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

  /**
   * Recarrega a conversa aberta e a lista. Usado depois de assumir, aceitar,
   * recusar ou transferir: são ações que mudam quem é o dono e o status, e
   * esperar só pelo evento de tempo real deixava o botão errado na tela por
   * alguns instantes.
   */
  function refreshCurrent() {
    if (selectedId) {
      loadDetail(selectedId).catch(() => {});
    }
    loadConversations(filters).catch(() => {});
    loadCounts();
  }

  async function handleAction(path: string, errorMessage: string) {
    if (!selectedId) return;
    try {
      await apiFetch(`/conversations/${selectedId}/${path}`, { method: "POST" });
      // Espera a conversa voltar antes de devolver o controle: é isso que
      // faz o botão continuar em "carregando" até o estado novo estar na
      // tela, em vez de voltar ao normal e mudar de rótulo um instante
      // depois — que dava a impressão de que o clique não pegou.
      await loadDetail(selectedId).catch(() => {});
      await loadConversations(filters).catch(() => {});
      loadCounts();
    } catch {
      toast.error(errorMessage);
    }
  }

  /**
   * Resolver, com a conversa saindo da lista à vista.
   *
   * A animação só existe quando ela REALMENTE vai sair — em "Resolvidas",
   * ou sem filtro de estado nenhum, a conversa continua ali e deslizá-la
   * pra fora seria mentir sobre o que aconteceu.
   *
   * A ordem importa: primeiro a chamada, e só depois o movimento. Animar
   * antes deixaria a linha sair da tela pra reaparecer quando a rede
   * falhasse — e o erro apareceria num canto com a lista já mexida.
   */
  async function handleResolve() {
    if (!selectedId) return;
    const id = selectedId;
    try {
      await apiFetch(`/conversations/${id}/resolve`, { method: "POST" });
      await loadDetail(id).catch(() => {});

      if (mostraResolvidas(filters)) {
        await loadConversations(filters).catch(() => {});
      } else {
        setSaindoDaLista(id);
        // O mesmo tempo da animação em globals.css. Recarregar antes faria
        // a linha sumir no meio do movimento; depois, ela já saiu.
        await new Promise((pronto) => setTimeout(pronto, 340));
        await loadConversations(filters).catch(() => {});
        setSaindoDaLista(null);
      }
      loadCounts();
    } catch {
      setSaindoDaLista(null);
      toast.error("Não deu pra resolver essa conversa.");
    }
  }

  /**
   * Apaga do painel. A confirmação (com o aviso de que a mensagem continua
   * no celular do cliente) já aconteceu no ChatPanel — aqui é só a chamada.
   */
  async function handleDelete(messageId: string) {
    if (!selectedId) return;
    try {
      await apiFetch(`/conversations/${selectedId}/messages/${messageId}`, {
        method: "DELETE",
      });
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === messageId
                  ? { ...m, deletedAt: new Date().toISOString(), content: "", metadata: null }
                  : m,
              ),
            }
          : prev,
      );
    } catch (erro) {
      toast.error(erro instanceof ApiError ? erro.message : "Não deu pra apagar a mensagem.");
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
    //
    // A coluna da lista tem 440px, e não os 400 de antes: a linha carrega
    // nome, prévia, hora e selos, e em 400 a prévia era cortada no meio da
    // primeira frase — que é justamente o que se lê pra decidir se abre.
    <TranscricaoDeAudioProvider modo={transcricao}>
    <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden bg-card md:grid-cols-[440px_1fr] xl:grid-cols-[440px_1fr_330px] [&>*]:min-h-0">
      <div className="hidden min-h-0 flex-col border-r md:flex">
        {/* Sem o simulador de cliente: ele existia pra testar o fluxo antes
            de o WhatsApp estar conectado. Com o canal no ar ele só criava
            conversa falsa no meio das de verdade. O endpoint continua na
            API pros testes automatizados. */}
        {/* Puxar conversa mora AQUI, ao lado da busca.
            Ele nasceu na tela de Clientes, com o argumento de que só faz
            sentido depois de escolher com quem falar. O argumento valia
            enquanto a ação exigia um cliente já cadastrado; agora ela
            aceita um número digitado na hora, e o gesto de "quero falar
            com alguém" acontece no Inbox — é onde a mão vai procurar,
            como o lápis do WhatsApp Web. */}
        <InboxFilterBar
          value={filters}
          counts={counts}
          onChange={setFilters}
          action={
            <StartConversationDialog
              onStarted={(id) => {
                // Abre a conversa na hora e recarrega a lista: a conversa
                // acabou de nascer e ainda não está no recorte carregado.
                abrirConversa(id);
                void loadConversations(filters);
                loadCounts(filters);
              }}
              gatilho={
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Nova conversa"
                  title="Nova conversa"
                  className="size-10 shrink-0 rounded-lg"
                >
                  <SquarePen className="size-4.5" />
                </Button>
              }
            />
          }
        />
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          liveUnread={unreadCounts}
          loading={loadingList}
          hasMore={Boolean(cursor)}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
          onSelect={abrirConversa}
          relogio={relogio}
          saindo={saindoDaLista}
        />
      </div>
      {/* Remontar ao trocar de conversa zera rascunho e busca — que é o
          esperado: rascunho de uma conversa não pode aparecer na outra. */}
      <ChatPanel
        key={selectedId ?? "vazio"}
        conversation={detail}
        loading={Boolean(selectedId) && !detail}
        sending={sending}
        replyTo={replyTo}
        hasOlder={Boolean(messagesCursor)}
        onLoadOlder={loadOlderMessages}
        onReply={setReplyTo}
        onCancelReply={() => setReplyTo(null)}
        onReact={handleReact}
        onRead={() => selectedId && marcarLida(selectedId)}
        onDelete={handleDelete}
        podeEnviarEncerrada={podeEnviarEncerrada}
        onClose={() => abrirConversa(null)}
        onSend={handleSend}
        onSendFile={handleSendFile}
        onRefresh={refreshCurrent}
        onResolve={handleResolve}
        onReopen={() => handleAction("reopen", "Não deu pra reabrir essa conversa.")}
        onChangePriority={handlePriority}
      />
      <div className="hidden overflow-y-auto border-l xl:block">
        <CustomerPanel conversation={detail} />
      </div>
    </div>
    </TranscricaoDeAudioProvider>
  );
}
