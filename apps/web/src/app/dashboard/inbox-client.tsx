"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StartConversationDialog } from "@/components/customers/start-conversation-dialog";
import { ChatPanel } from "@/components/inbox/chat-panel";
import { ConversationList } from "@/components/inbox/conversation-list";
import { CustomerPanel } from "@/components/inbox/customer-panel";
import {
  ABAS,
  DEFAULT_FILTERS,
  InboxFilterBar,
  filtrosDaAba,
  type FilterCounts,
  type InboxFilters,
} from "@/components/inbox/inbox-filters";
import { useRealtime } from "@/components/realtime-provider";
import { useTelaLarga } from "@/hooks/use-tela-larga";
import { conferirPrimeiraPagina } from "@/lib/conferencia-da-lista";
import { useSession } from "@/components/session-provider";
import type { Relogio } from "@/lib/espera";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { criarAgrupadorDeRajada } from "@/lib/agrupar-rajada";
import { conversationCache } from "@/lib/conversation-cache";
import { inboxListCache } from "@/lib/inbox-list-cache";
import { ordenarConversas, pertenceAoFiltro } from "@/lib/inbox-filtro";
import { buildQuery, gravarFiltrosNoCookie } from "@/lib/inbox-query";
import { usePersistedState } from "@/lib/use-persisted-state";
import { cn } from "@/lib/utils";
import type {
  ConversationDetail,
  ConversationMessage,
  ConversationPriority,
  ConversationSummary,
  ConversationUpdate,
  InboxSettings,
  MessageStatus,
} from "@/lib/types";
import { TranscricaoDeAudioProvider } from "@/components/inbox/transcricao-de-audio";

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * A primeira página da lista, já buscada pelo SERVIDOR.
 *
 * É o que faz o Inbox abrir com as conversas na tela em vez de um
 * esqueleto: sem isto, a sequência era baixar o HTML vazio, baixar o
 * JavaScript, hidratar, ler os filtros do localStorage e só então PEDIR as
 * conversas — quatro etapas em fila antes de a primeira letra aparecer.
 * Com os dados vindo dentro do HTML, a lista já está escrita quando a
 * página chega.
 *
 * Nulo quando o servidor não conseguiu buscar (API fora, sessão expirando
 * no meio): aí a tela volta a carregar pelo navegador, como antes.
 */
export interface DadosIniciaisDoInbox {
  conversas: Page<ConversationSummary>;
  contadores: FilterCounts;
  /** A conversa pedida pela URL (`?c=`), com a primeira página de mensagens. */
  conversa: (ConversationDetail & { messagesCursor: string | null }) | null;
  /** O recorte com que o servidor montou a página (vindo do cookie). */
  filtros: InboxFilters;
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
  grupos: 0,
  status: {},
  priority: {},
};


/**
 * O recorte guardado no navegador é o mesmo com que o servidor montou a
 * primeira página?
 *
 * O servidor não tem acesso ao localStorage, então ele sempre monta a
 * lista com os filtros padrão. Quem guardou outro recorte precisa de uma
 * busca nova ao hidratar; quem está no padrão — a maioria — já tem na tela
 * exatamente o que pediria, e repetir a chamada só gastaria uma ida ao
 * servidor pra receber de volta o que já está escrito.
 */
function mesmoRecorte(a: InboxFilters, b: InboxFilters): boolean {
  return (Object.keys(b) as (keyof InboxFilters)[]).every((chave) => a[chave] === b[chave]);
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


export function InboxClient({ inicial }: { inicial: DadosIniciaisDoInbox | null }) {
  const searchParams = useSearchParams();
  const { user, tenant } = useSession();
  const telaLarga = useTelaLarga();
  // Identifica de quem é o cache: troca de usuário/empresa na mesma aba
  // (SPA, sem recarregar) não reinicia esta variável de módulo sozinha —
  // ver `conversationCache`, que descarta tudo quando esta chave muda.
  const chaveDaSessao = `${tenant.id}:${user.id}:${user.role}`;
  const [conversations, setConversations] = useState<ConversationSummary[]>(
    inicial?.conversas.items ?? [],
  );
  const [cursor, setCursor] = useState<string | null>(inicial?.conversas.nextCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  /**
   * A conversa resolvida que está deslizando pra fora da lista.
   *
   * Existe só entre o "resolvido" do servidor e a lista voltar sem ela —
   * ver `handleResolve` e a animação em globals.css.
   */
  const [saindoDaLista, setSaindoDaLista] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("c"));
  const [detail, setDetail] = useState<ConversationDetail | null>(inicial?.conversa ?? null);
  const [messagesCursor, setMessagesCursor] = useState<string | null>(
    inicial?.conversa?.messagesCursor ?? null,
  );
  const [counts, setCounts] = useState<FilterCounts>(inicial?.contadores ?? EMPTY_COUNTS);
  const [sending, setSending] = useState(false);
  // Com a lista já vinda do servidor não existe "carregando": ela está na
  // tela desde o primeiro quadro.
  const [loadingList, setLoadingList] = useState(inicial === null);
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
  // O recorte do servidor como ponto de partida: é o que a primeira página
  // mostra, e a aba acesa já nasce certa, sem esperar o navegador ler o
  // que tinha guardado.
  const [filters, setFilters, filtersReady] = usePersistedState<InboxFilters>(
    "inbox-filters",
    inicial?.filtros ?? DEFAULT_FILTERS,
  );
  // A cópia que viaja com o pedido da página (ver `lerFiltrosDoCookie`).
  useEffect(() => {
    if (filtersReady) gravarFiltrosNoCookie(filters);
  }, [filters, filtersReady]);

  const selectedIdRef = useRef<string | null>(null);
  /** Vira falso na primeira passada do efeito de carga — ver `mesmoRecorte`. */
  const primeiraPaginaDoServidor = useRef(inicial !== null);
  /**
   * A conversa que o servidor já mandou pronta, pra o efeito de abertura
   * não apagá-la da tela e buscar de novo o que acabou de chegar.
   */
  const conversaDoServidor = useRef(inicial?.conversa?.id ?? null);
  /**
   * Se o próximo `connect` do socket é a PRIMEIRA conexão desta tela, e
   * não uma volta depois de cair. Decidido uma vez só, na primeira vez que
   * o socket aparece: se ele já estava conectado (a pessoa navegou de outra
   * tela do painel), todo `connect` dali em diante é reconexão.
   */
  const conexaoInicialPendente = useRef<boolean | null>(null);
  const conversationsRef = useRef<ConversationSummary[]>([]);
  /** Uma animação de reordenar por vez (ver `onConversationUpdated`). */
  const transicaoEmCurso = useRef(false);
  const ultimaTransicao = useRef(0);
  const ultimoEventoDaLista = useRef(0);
  const { socket, unreadCounts, clearUnread, setActiveConversationId, sincronizar } =
    useRealtime();

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
  /**
   * O que ESTA tela escreveu no `?c=`. Quando a URL volta com um desses
   * valores, é o eco do próprio clique, não um pedido de fora — e eco
   * atrasado não pode reabrir uma conversa que a pessoa já deixou pra trás
   * (ver `abrirConversa`).
   */
  const escritasNaUrl = useRef(new Set<string>());
  useEffect(() => {
    if (!conversaDaUrl) return;
    if (escritasNaUrl.current.has(conversaDaUrl)) {
      // Chegou o eco de uma escrita nossa: as anteriores a ela já foram
      // superadas, e um pedido de fora com o mesmo id (notificação)
      // precisa voltar a funcionar.
      escritasNaUrl.current.clear();
      return;
    }
    if (conversaDaUrl === selectedIdRef.current) return;
    setSelectedId(conversaDaUrl);
  }, [conversaDaUrl]);

  const unreadCountsRef = useRef<Record<string, number>>({});
  useEffect(() => {
    unreadCountsRef.current = unreadCounts;
  }, [unreadCounts]);

  /**
   * A conversa guardada que pode ser mostrada JÁ, ou nada.
   *
   * Com não lidas, só a memória mantida em dia pelo tempo real serve (ver
   * `conversationCache.emDia`): uma guardada antes da última queda pode
   * não ter as mensagens novas, e mostrá-la pra corrigir logo depois é o
   * "abre o de ontem, pula pro de hoje".
   */
  const detalheGuardado = useCallback(
    (id: string) => {
      const resumo = conversationsRef.current.find((item) => item.id === id);
      const podeEstarDesatualizado =
        !conversationCache.emDia(chaveDaSessao, id) &&
        ((resumo?.unreadCount ?? 0) > 0 || (unreadCountsRef.current[id] ?? 0) > 0);
      return podeEstarDesatualizado ? undefined : conversationCache.get(chaveDaSessao, id);
    },
    [chaveDaSessao],
  );

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
   *
   * E `history.replaceState`, NÃO `router.replace`. O do roteador é uma
   * navegação: pedia a página de novo ao servidor — que busca lista,
   * contadores e a conversa — a cada clique. Clicando rápido em várias
   * conversas, essas navegações terminavam uma depois da outra, cada uma
   * devolvendo o `?c=` do seu clique, e a tela "voltava" pelas conversas
   * anteriores até alcançar a atual. O nativo só troca o endereço; o Next
   * sincroniza o `useSearchParams` sem viagem nenhuma.
   */
  const abrirConversa = useCallback((id: string | null) => {
    // O ref vai junto, já no clique: o efeito que o atualiza só roda
    // depois da renderização, e até lá o eco da URL o encontraria velho.
    selectedIdRef.current = id;
    setSelectedId(id);
    // A conversa guardada entra NO MESMO render da troca, e não num efeito
    // depois dele: é esse primeiro render que o painel usa pra decidir o
    // que mostrar (e onde vai a tarja de não lidas). Um quadro que seja
    // com "carregando" antes da conversa já guardada é o piscar que tira
    // a sensação de instantâneo.
    const guardada = id ? detalheGuardado(id) : undefined;
    setDetail(guardada ? guardada.detail : null);
    setMessagesCursor(guardada ? guardada.messagesCursor : null);
    if (id) escritasNaUrl.current.add(id);
    window.history.replaceState(
      null,
      "",
      id ? `/dashboard?c=${id}` : "/dashboard",
    );
  }, [detalheGuardado]);

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
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  /**
   * Só a contagem MAIS RECENTE vale — mesma regra da lista (`pedidoDaLista`).
   *
   * Sem isso, trocar de filtro rápido deixava o cabeçalho respondendo sobre
   * o recorte anterior: a contagem antiga chega depois da nova e sobrescreve
   * os números, e aí os botões passam a discordar da lista embaixo deles —
   * exatamente a contradição que os contadores por faceta vieram resolver.
   */
  const pedidoDaContagem = useRef(0);
  const loadCounts = useCallback((current: InboxFilters = filtersRef.current) => {
    const meu = ++pedidoDaContagem.current;
    apiFetch<FilterCounts>(buildQuery(current, null, "/conversations/counts"))
      .then((novos) => {
        if (meu === pedidoDaContagem.current) setCounts(novos);
      })
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
  /*
   * Espera a rajada acabar — mas não pra sempre.
   *
   * Só o "espera 400ms de silêncio" deixava os números das abas parados
   * justamente na hora de pico: com mensagem chegando a cada 300ms em
   * alguma conversa, o silêncio nunca vinha. Agora, passados 2s desde o
   * primeiro evento da rajada, a contagem sai de qualquer jeito.
   */
  const primeiraDaRajada = useRef<number | null>(null);
  const agendarContagem = useCallback(() => {
    if (contagemAgendada.current) clearTimeout(contagemAgendada.current);
    const agora = Date.now();
    primeiraDaRajada.current ??= agora;
    const espera = Math.max(0, Math.min(400, primeiraDaRajada.current + 2000 - agora));
    contagemAgendada.current = setTimeout(() => {
      primeiraDaRajada.current = null;
      loadCounts();
    }, espera);
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
  const loadConversations = useCallback(
    async (current: InboxFilters) => {
      const meu = ++pedidoDaLista.current;
      try {
        const page = await apiFetch<Page<ConversationSummary>>(buildQuery(current));
        if (meu !== pedidoDaLista.current) return;
        setConversations(page.items);
        setCursor(page.nextCursor);
        setLoadingList(false);
        // Sem busca de texto: é a aba/recorte que se repete de sessão pra
        // sessão de uso, e é isso que fica em cache pra a próxima troca de
        // aba pintar na hora. Busca é sempre nova, cachear não ajudaria.
        if (!current.search.trim()) {
          inboxListCache.set(chaveDaSessao, buildQuery(current), {
            items: page.items,
            nextCursor: page.nextCursor,
            filtros: current,
          });
        }
      } catch (erro) {
        // Falhar também tira o esqueleto: senão a tela gira pra sempre e
        // ninguém entende que a busca acabou (mal).
        if (meu === pedidoDaLista.current) setLoadingList(false);
        throw erro;
      }
    },
    [chaveDaSessao],
  );

  /**
   * A página seguinte só entra se o recorte não mudou no meio do caminho.
   *
   * `loadConversations` já descartava resposta velha por geração, mas esta
   * aqui não: rolar até o fim e trocar de filtro antes de a página voltar
   * emendava conversas do recorte antigo embaixo do novo, e ainda deixava o
   * cursor do recorte antigo valendo — então continuar rolando trazia mais
   * do filtro errado. A geração é a MESMA de `loadConversations`, porque
   * uma busca nova da lista também invalida a continuação da anterior.
   */
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    const meu = pedidoDaLista.current;
    setLoadingMore(true);
    try {
      const page = await apiFetch<Page<ConversationSummary>>(buildQuery(filters, cursor));
      if (meu !== pedidoDaLista.current) return;
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

  /**
   * O histórico importado pode ter tocado conversas que a lista ainda não
   * mostra — e a tela não pode ficar esperando um F5 pra elas aparecerem
   * (ver F02). Busca só a PRIMEIRA página do recorte atual e mescla no
   * que já está na tela: atualiza quem já tinha aparecido, insere quem
   * passou a bater com o filtro, tira quem deixou de bater. Nunca toca no
   * `cursor` — é o que preserva as páginas que a pessoa já rolou pra
   * baixo, em vez de descartá-las como uma busca nova faria.
   */
  const reconciliarHistorico = useCallback(async () => {
    const meu = pedidoDaLista.current;
    try {
      const page = await apiFetch<Page<ConversationSummary>>(buildQuery(filtersRef.current));
      if (meu !== pedidoDaLista.current) return;
      setConversations((prev) => {
        const porId = new Map(prev.map((item) => [item.id, item] as const));
        for (const item of page.items) porId.set(item.id, item);
        const mesclado = [...porId.values()].filter((item) =>
          pertenceAoFiltro(item, filtersRef.current, user.id),
        );
        return ordenarConversas(mesclado, filtersRef.current.ordem);
      });
    } catch {
      // Silencioso de propósito: é reconciliação em segundo plano — o
      // próximo lote (ou o próximo `agendarContagem`) tenta de novo.
    }
  }, [user.id]);

  const loadDetail = useCallback(
    async (id: string) => {
      const conversation = await apiFetch<
        ConversationDetail & { messagesCursor: string | null }
      >(`/conversations/${id}`);
      conversationCache.set(chaveDaSessao, id, {
        detail: conversation,
        messagesCursor: conversation.messagesCursor,
      });
      // Só aplica se a pessoa ainda está nessa conversa: numa troca rápida
      // a resposta antiga chegaria depois e sobrescreveria a nova.
      if (selectedIdRef.current === id) {
        setDetail((prev) => {
          // Sem detalhe anterior desta MESMA conversa pra reconciliar —
          // troca de conversa, primeira abertura — a resposta do servidor
          // já é o estado inteiro.
          if (!prev || prev.id !== id) return conversation;

          // A mensagem `message.created` do socket pode ter chegado
          // ENQUANTO este GET estava no ar — o servidor tirou a foto antes
          // dela existir. Sem isto, a resposta do GET (que "venceu" só por
          // ter chegado depois) apagava da tela uma mensagem que o socket
          // já tinha entregue.
          const ultimaDoServidor = conversation.messages.at(-1)?.createdAt;
          const chegaramDepoisPeloSocket = ultimaDoServidor
            ? prev.messages.filter(
                (m) =>
                  !m.id.startsWith(ID_OTIMISTA) &&
                  m.createdAt > ultimaDoServidor &&
                  !conversation.messages.some((sm) => sm.id === m.id),
              )
            : [];

          return {
            ...conversation,
            messages: [...conversation.messages, ...chegaramDepoisPeloSocket],
          };
        });
        setMessagesCursor(conversation.messagesCursor);
      }
      // Abrir não zera mais nada: quem zera é `marcarLida`, quando o fim da
      // conversa aparece na tela. O contador segue intacto até lá porque é
      // dele que sai a tarja de "N mensagens não lidas".
    },
    [chaveDaSessao],
  );

  /**
   * Agrupa os lotes de histórico antes de reconciliar — sem isto, uma
   * importação de 50 mil mensagens dispara uma busca da lista a cada
   * webhook, dezenas por segundo. A janela e o prazo máximo em si vivem
   * em `criarAgrupadorDeRajada` (testado à parte); aqui só entra o que é
   * específico do Inbox — quais ids acumular e o que fazer quando a
   * rajada assenta.
   *
   * O agrupador em si é criado dentro do efeito do socket, não aqui: ele
   * guarda esta função numa closure pra chamar DEPOIS, e só um efeito é
   * "fora da renderização" o bastante pra isso — criá-lo num `useMemo`
   * ou num `useState` preguiçoso soa igual, mas os dois ainda rodam
   * durante o render.
   */
  const idsAfetadosRef = useRef<Set<string>>(new Set());

  const flusharReconciliacaoDeHistorico = useCallback(() => {
    const ids = idsAfetadosRef.current;
    idsAfetadosRef.current = new Set();

    void reconciliarHistorico();
    agendarContagem();
    // A conversa aberta também pode ter ganhado mensagem nova do lote —
    // sem isto, quem está lendo uma conversa antiga vê a lista atualizar
    // e o painel aberto continuar do jeito que estava até reabrir.
    if (selectedIdRef.current && ids.has(selectedIdRef.current)) {
      void loadDetail(selectedIdRef.current);
    }
  }, [reconciliarHistorico, agendarContagem, loadDetail]);

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

  /**
   * A página antiga só entra se ainda for a MESMA conversa.
   *
   * O id era lido antes do `await` e o resultado aplicado no que estivesse
   * aberto quando a resposta voltasse. Rolar pra cima na conversa A e
   * trocar pra B antes de responder colava o histórico de A dentro de B —
   * e o cursor de A virava o cursor de B, então continuar rolando trazia
   * mais conversa errada. Conferir o id na volta descarta a resposta que
   * perdeu a corrida, que é o que ela merece.
   */
  const loadOlderMessages = useCallback(async () => {
    const daConversa = selectedIdRef.current;
    if (!messagesCursor || !daConversa) return;
    const page = await apiFetch<Page<ConversationMessage>>(
      `/conversations/${daConversa}/messages?cursor=${messagesCursor}`,
    );
    if (selectedIdRef.current !== daConversa) return;
    setDetail((prev) =>
      prev && prev.id === daConversa
        ? { ...prev, messages: [...page.items, ...prev.messages] }
        : prev,
    );
    setMessagesCursor(page.nextCursor);
  }, [messagesCursor]);

  useEffect(() => {
    if (!filtersReady) return;
    // A primeira página veio pronta do servidor. Se o recorte restaurado é
    // o mesmo com que ela foi montada, buscar agora seria pedir de novo o
    // que já está na tela — e o esqueleto piscaria por cima de uma lista
    // que já estava certa.
    if (primeiraPaginaDoServidor.current) {
      primeiraPaginaDoServidor.current = false;
      if (inicial) {
        // A primeira página também é uma aba: guardada, voltar a ela depois
        // de visitar outra não busca de novo.
        inboxListCache.set(chaveDaSessao, buildQuery(inicial.filtros), {
          items: inicial.conversas.items,
          nextCursor: inicial.conversas.nextCursor,
          filtros: inicial.filtros,
        });
        if (mesmoRecorte(filters, inicial.filtros)) return;
      }
    }

    // Aba já visitada nesta sessão: pinta da memória na hora — sem
    // esqueleto — e ainda assim busca no servidor embaixo, pra reconciliar
    // o que mudou desde a última vez. Sem busca de texto só, pelo mesmo
    // motivo do cache não gravar: recorte de texto é sempre novo.
    const cache = !filters.search.trim()
      ? inboxListCache.get(chaveDaSessao, buildQuery(filters))
      : undefined;
    if (cache) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConversations(cache.items);
      setCursor(cache.nextCursor);
      setLoadingList(false);
    } else {
      setLoadingList(true);
    }

    // Aba que o tempo real vem mantendo em dia: a lista da memória já é a
    // do servidor, e pedir de novo só custaria uma consulta por clique.
    const emDia =
      Boolean(cache) && inboxListCache.emDia(chaveDaSessao, buildQuery(filters));

    const timer = setTimeout(() => {
      // Lista e contadores saem juntos, do mesmo recorte: é o que garante
      // que o número no botão e o que aparece embaixo dele falem da mesma
      // coisa.
      loadCounts(filters);
      if (emDia) {
        // Invalida qualquer resposta de outra aba ainda no ar: ela não pode
        // chegar depois e pintar por cima desta.
        pedidoDaLista.current += 1;
        return;
      }
      loadConversations(filters).catch(() =>
        toast.error("Não deu pra carregar as conversas."),
      );
    }, filters.search ? 250 : 0);
    return () => clearTimeout(timer);
    // `inicial` é a página que veio do servidor: não muda depois da
    // montagem, e só é lida na primeira passada (ver acima).
  }, [filters, filtersReady, loadConversations, loadCounts, chaveDaSessao, inicial]);

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
    // Esta conversa veio pronta dentro do HTML, buscada há alguns
    // milissegundos: pedir de novo agora só faria a tela piscar em branco
    // pra reescrever o que já está nela. O tempo real cuida do resto.
    if (conversaDoServidor.current === selectedId) {
      conversaDoServidor.current = null;
      return;
    }
    // Pinta do cache na hora (troca de conversa fica instantânea) e busca
    // do servidor em segundo plano só pra reconciliar — EXCETO quando já
    // se sabe que o cache está velho. Uma conversa com não lida (contador
    // do servidor ou do socket) tem mensagem que o cache não viu; pintar
    // ele mesmo assim só pra corrigir de novo alguns instantes depois é o
    // "abre, mostra o de ontem, pula pra hoje" que confundia. Aqui é
    // melhor esperar: a tela mostra "carregando" e só pinta quando já vem
    // completa, com o separador de não lidas no lugar certo desde o
    // primeiro quadro.
    //
    // O `setDetail(null)` antes é o que mata o piscar: sem ele, o React
    // mantinha a conversa ANTERIOR na tela durante o quadro em que a nova
    // ainda não chegou — dava a impressão de a conversa errada abrir e só
    // depois trocar. Melhor um instante vazio que a conversa errada.
    //
    // "Em dia" vence o contador: a memória que recebeu pelo tempo real
    // toda mensagem desde que foi guardada já TEM as não lidas, e abre na
    // hora com o separador no lugar certo (ver `conversationCache.emDia`).
    const cached = detalheGuardado(selectedId);
    setDetail(cached ? cached.detail : null);
    setMessagesCursor(cached ? cached.messagesCursor : null);
    loadDetail(selectedId).catch(() => toast.error("Não deu pra carregar essa conversa."));
    // A lista e os contadores entram pelos refs de `detalheGuardado`, e não
    // como dependência: o que importa é o valor no instante em que a
    // conversa TROCOU — reagir a toda atualização da lista reabriria a
    // mesma conversa do zero a cada mensagem alheia.
  }, [selectedId, loadDetail, chaveDaSessao, detalheGuardado]);

  /*
   * Pré-carregamento: trazer a conversa ANTES do clique.
   *
   * É o que tira o "carregando" entre um chat e outro. A memória de
   * conversas (`conversationCache`) fica em dia sozinha pelo tempo real
   * depois de preenchida; o que faltava era preenchê-la antes de a pessoa
   * pedir. Três momentos: o ponteiro parado sobre a linha, a mensagem nova
   * que chega numa conversa ainda não guardada, e logo depois de conectar
   * — as conversas com não lidas, que são as próximas a ser abertas.
   *
   * No máximo duas buscas ao mesmo tempo: pré-carregar é aposta, e não
   * pode disputar a rede com o que a pessoa de fato pediu.
   */
  const preCarregando = useRef(new Set<string>());
  /** Mensagem chegou enquanto a busca estava no ar: a resposta já nasce velha. */
  const chegouDuranteABusca = useRef(new Set<string>());
  const esperasDePreCarga = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  /** Chamado quando uma busca termina e libera vaga (ver a fila das visíveis). */
  const aoLiberarVaga = useRef<(() => void) | null>(null);

  const preCarregar = useCallback(
    (
      id: string,
      { adiar = false, previa = false }: { adiar?: boolean; previa?: boolean } = {},
    ) => {
      const executar = () => {
        esperasDePreCarga.current.delete(id);
        if (
          id === selectedIdRef.current ||
          conversationCache.emDia(chaveDaSessao, id) ||
          preCarregando.current.has(id) ||
          preCarregando.current.size >= 2
        ) {
          return;
        }
        preCarregando.current.add(id);
        chegouDuranteABusca.current.delete(id);
        apiFetch<ConversationDetail & { messagesCursor: string | null }>(
          // A prévia da lista traz só o começo da conversa: é o que aparece
          // na tela ao abrir, e o resto vem pela rolagem, como sempre.
          previa ? `/conversations/${id}?limit=20` : `/conversations/${id}`,
        )
          .then((conversa) => {
            // Aberta enquanto a busca corria: quem manda agora é o
            // `loadDetail` da abertura, que também grava na memória.
            if (id === selectedIdRef.current) return;
            if (chegouDuranteABusca.current.has(id)) {
              // Busca de novo daqui a pouco, já com a mensagem que chegou.
              chegouDuranteABusca.current.delete(id);
              esperasDePreCarga.current.set(id, setTimeout(executar, 800));
              return;
            }
            conversationCache.set(chaveDaSessao, id, {
              detail: conversa,
              messagesCursor: conversa.messagesCursor,
              previa,
            });
          })
          .catch(() => {})
          .finally(() => {
            preCarregando.current.delete(id);
            aoLiberarVaga.current?.();
          });
      };

      if (!adiar) {
        executar();
        return;
      }
      // Rajada de mensagens da mesma conversa vira uma busca só, no fim.
      const anterior = esperasDePreCarga.current.get(id);
      if (anterior) clearTimeout(anterior);
      esperasDePreCarga.current.set(id, setTimeout(executar, 800));
    },
    [chaveDaSessao],
  );

  useEffect(
    () => () => {
      for (const espera of esperasDePreCarga.current.values()) clearTimeout(espera);
    },
    [],
  );

  /*
   * As conversas que estão NA TELA, trazidas em segundo plano.
   *
   * A lista avisa quais linhas ficaram visíveis (ver `onVisiveis` na
   * ConversationList); cada uma tem o começo da conversa buscado, uma por
   * vez, pra abrir sem espera quando for clicada. Só o texto das mensagens
   * vem nessa busca — foto, áudio e vídeo só são baixados quando o balão
   * aparece de fato numa conversa aberta.
   *
   * Uma vaga só, e não as duas do pré-carregamento: esta é a aposta mais
   * fraca de todas (a pessoa pode nunca clicar), e a outra vaga fica livre
   * pro que tem mais chance — o mouse parado sobre uma linha, a mensagem
   * nova. O que sai da tela sai também da memória (ver
   * `conversationCache.descartarPrevias`).
   */
  const visiveis = useRef(new Set<string>());
  const filaDeVisiveis = useRef<string[]>([]);

  const drenarVisiveis = useCallback(() => {
    while (preCarregando.current.size === 0 && filaDeVisiveis.current.length > 0) {
      const id = filaDeVisiveis.current.shift() as string;
      if (!visiveis.current.has(id)) continue;
      if (conversationCache.emDia(chaveDaSessao, id)) continue;
      preCarregar(id, { previa: true });
    }
  }, [chaveDaSessao, preCarregar]);

  useEffect(() => {
    aoLiberarVaga.current = drenarVisiveis;
    return () => {
      aoLiberarVaga.current = null;
    };
  }, [drenarVisiveis]);

  const preCarregarVisiveis = useCallback(
    (ids: string[]) => {
      visiveis.current = new Set(ids);
      const manter = new Set(ids);
      if (selectedIdRef.current) manter.add(selectedIdRef.current);
      conversationCache.descartarPrevias(chaveDaSessao, manter);
      // Uma tela de lista tem umas dez conversas; mais que isso é rolagem
      // rápida, e buscar tudo que passou seria trabalho jogado fora.
      filaDeVisiveis.current = ids.slice(0, 12);
      drenarVisiveis();
    },
    [chaveDaSessao, drenarVisiveis],
  );

  /**
   * Logo depois de conectar: as conversas com não lidas e as outras abas.
   *
   * Com um respiro de um segundo e meio, pra não competir com o que a
   * abertura da tela ainda está pedindo. As abas vêm uma de cada vez e
   * ficam em dia pelo tempo real dali em diante (ver
   * `inboxListCache.aplicarConversa`) — trocar de aba passa a ser só
   * trocar o que está na tela.
   */
  const esperaDoAquecimento = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aquecer = useCallback(() => {
    if (esperaDoAquecimento.current) clearTimeout(esperaDoAquecimento.current);
    esperaDoAquecimento.current = setTimeout(async () => {
      // As abas primeiro, e todas juntas: é o que a pessoa troca logo nos
      // primeiros segundos. Uma de cada vez, a última só ficava pronta
      // uns quatro segundos depois de abrir — tempo de sobra pra alguém
      // tocar nela e ver o "carregando".
      const atual = filtersRef.current;
      if (!atual.search.trim()) {
        await Promise.all(
          ABAS.map(async (aba) => {
            const filtros = filtrosDaAba(atual, aba);
            const chave = buildQuery(filtros);
            // A aba aberta já é cuidada pela tela (conferência da conexão,
            // carga do filtro e tempo real) — buscar aqui seria em dobro.
            if (chave === buildQuery(atual)) return;
            if (inboxListCache.emDia(chaveDaSessao, chave)) return;
            try {
              const page = await apiFetch<Page<ConversationSummary>>(chave);
              inboxListCache.set(chaveDaSessao, chave, {
                items: page.items,
                nextCursor: page.nextCursor,
                filtros,
              });
            } catch {
              // Aba que não veio agora vem no clique, como antes.
            }
          }),
        );
      }

      conversationsRef.current
        .filter((conversa) => conversa.unreadCount > 0)
        .slice(0, 6)
        .forEach((conversa, indice) => {
          setTimeout(() => preCarregar(conversa.id), indice * 300);
        });
    }, 250);
  }, [chaveDaSessao, preCarregar]);

  useEffect(
    () => () => {
      if (esperaDoAquecimento.current) clearTimeout(esperaDoAquecimento.current);
    },
    [],
  );

  // Sem tempo real (rede que bloqueia websocket, servidor reiniciando), o
  // aquecimento acontece do mesmo jeito: as abas não ficam "em dia", mas
  // aparecem na hora e se conferem por baixo — melhor que o esqueleto.
  useEffect(() => {
    const espera = setTimeout(() => {
      if (!socket?.connected) aquecer();
    }, 3000);
    return () => clearTimeout(espera);
  }, [socket, aquecer]);

  useEffect(() => {
    if (!socket) return;

    // Vive só enquanto este efeito viver: a limpeza no fim cancela
    // qualquer reconciliação agendada, junto com os `socket.off` abaixo.
    const agrupadorDeHistorico = criarAgrupadorDeRajada(
      flusharReconciliacaoDeHistorico,
      { janela: 600, prazoMaximo: 3000 },
    );

    if (conexaoInicialPendente.current === null) {
      conexaoInicialPendente.current = !socket.connected;
    }

    /*
     * A primeira conexão só confere, não recarrega.
     *
     * Lista, contadores e conversa aberta acabaram de chegar junto com o
     * HTML; buscar os três de novo um segundo depois — como numa
     * reconexão — era a abertura do Inbox pagando tudo duas vezes, e os
     * contadores sozinhos são uma dúzia de consultas. O que pode ter
     * escapado é só o que chegou antes de o socket conectar, e isso uma
     * página da lista mostra. Só se ela mudou é que o resto vem.
     */
    const conferirAoConectarPelaPrimeiraVez = async () => {
      const meu = pedidoDaLista.current;
      try {
        const page = await apiFetch<Page<ConversationSummary>>(buildQuery(filtersRef.current));
        if (meu !== pedidoDaLista.current) return;
        const { mudou, mudaram } = conferirPrimeiraPagina(conversationsRef.current, page.items);
        // Mudando ou não, esta é a aba em dia nesta conexão.
        if (!filtersRef.current.search.trim()) {
          inboxListCache.set(chaveDaSessao, buildQuery(filtersRef.current), {
            items: page.items,
            nextCursor: page.nextCursor,
            filtros: filtersRef.current,
          });
        }
        if (!mudou) return;
        setConversations(page.items);
        setCursor(page.nextCursor);
        setLoadingList(false);
        loadCounts();
        const aberta = selectedIdRef.current;
        if (aberta && mudaram.has(aberta)) await loadDetail(aberta);
      } catch {
        // Silencioso: é conferência em segundo plano, e o próximo evento
        // do socket traz o que faltou.
      }
    };

    const onConnect = () => {
      // O que foi guardado antes desta conexão pode ter perdido mensagens
      // durante a queda (o servidor não reenvia): deixa de valer como "em
      // dia", e volta a valer conforme for buscado de novo.
      conversationCache.novaConexao();
      inboxListCache.novaConexao();
      aquecer();
      if (conexaoInicialPendente.current) {
        conexaoInicialPendente.current = false;
        void conferirAoConectarPelaPrimeiraVez();
        return;
      }
      // O servidor não reenvia o que se perdeu durante a queda: lista,
      // contadores e conversa aberta vêm de novo, e o cabeçalho mostra
      // "Sincronizando" até a lista e a conversa chegarem.
      const trabalho = Promise.all([
        loadConversations(filtersRef.current),
        selectedIdRef.current ? loadDetail(selectedIdRef.current) : null,
      ]).catch(() => {});
      sincronizar(trabalho);
      loadCounts();
    };

    /**
     * Lotes do histórico importado — ver F02.
     *
     * `RealtimeProvider` já escuta este mesmo evento pro giro de
     * progresso; este segundo ouvinte é o que faz a LISTA reagir, sem
     * esperar um F5. Os dois convivem: Socket.IO entrega o evento a
     * quantos `.on` quiserem escutar.
     */
    const onCanalHistorico = (evento: {
      estado: string;
      conversationIds?: string[];
    }) => {
      for (const id of evento.conversationIds ?? []) idsAfetadosRef.current.add(id);
      // Lote final: garante a atualização de vez, sem esperar as janelas.
      if (evento.estado !== "IMPORTANDO") {
        agrupadorDeHistorico.forcar();
      } else {
        agrupadorDeHistorico.disparar();
      }
    };

    const onConversationUpdated = (updated: ConversationUpdate) => {
      // O evento chega pra QUALQUER conversa que esta pessoa pode ver —
      // não só pra quem bate com o filtro aberto agora (ver
      // `pertenceAoFiltro`). Uma conversa resolvida some da aba de
      // Pendentes, um grupo nunca entra na caixa de clientes, a conversa
      // de outro atendente não fura "Minhas" — em vez de entrar direto e
      // esperar os contadores corrigirem depois.
      const pertence = pertenceAoFiltro(updated, filtersRef.current, user.id);

      // Mais recente sempre em cima: a conversa que acabou de receber
      // mensagem sobe pro topo, igual a qualquer mensageiro. A troca de
      // posição vai numa view transition — sem ela a lista "pisca" e quem
      // está lendo perde de vista onde estava. Onde o navegador não tem a
      // API, o estado muda igual, só que sem o deslizamento.
      const reorder = () =>
        setConversations((prev) => {
          const rest = prev.filter((item) => item.id !== updated.id);
          // Não estava e continua não estando: nada muda na lista, e
          // devolver o mesmo array poupa redesenhar tudo.
          if (!pertence) return rest.length === prev.length ? prev : rest;
          return ordenarConversas([updated, ...rest], filtersRef.current.ordem);
        });

      /*
       * A animação só quando a conversa MUDA DE LUGAR.
       *
       * Todo evento passava por aqui com animação — inclusive o tique de
       * entrega e a mensagem nova na conversa que já está no topo, que não
       * movem nada. Num número movimentado são vários eventos por segundo,
       * e cada transição fotografa a lista inteira e segura os cliques
       * enquanto roda: era o painel "engasgando" em horário de pico.
       *
       * E só com o movimento calmo: o evento anterior tem de ter vindo
       * há mais de 2s. Medido com 25 eventos por segundo (build de
       * produção): com animação em todo evento, 21 travadas de 50-95ms em
       * dez segundos e o digitar atrasando; limitando a uma a cada 1,5s,
       * ainda 13; assim, nenhuma. No pico a lista só se atualiza — que é
       * quando ninguém conseguiria acompanhar o deslize mesmo.
       */
      const agora = Date.now();
      const calmo = agora - ultimoEventoDaLista.current > 2000;
      ultimoEventoDaLista.current = agora;
      const atual = conversationsRef.current;
      const posicaoAntes = atual.findIndex((item) => item.id === updated.id);
      const posicaoDepois = pertence
        ? ordenarConversas(
            [updated, ...atual.filter((item) => item.id !== updated.id)],
            filtersRef.current.ordem,
          ).findIndex((item) => item.id === updated.id)
        : -1;
      const mudaDeLugar = posicaoAntes !== posicaoDepois;

      if (
        mudaDeLugar &&
        !transicaoEmCurso.current &&
        calmo &&
        agora - ultimaTransicao.current > 1500 &&
        document.visibilityState === "visible" &&
        typeof document.startViewTransition === "function"
      ) {
        try {
          const transicao = document.startViewTransition(() => flushSync(reorder));
          transicaoEmCurso.current = true;
          ultimaTransicao.current = agora;
          transicao.finished
            .finally(() => {
              transicaoEmCurso.current = false;
            })
            .catch(() => {});
          // Trava de segurança: em rajada de eventos essa API tem bugs
          // conhecidos (Chrome) em que a transição nunca termina, deixando
          // a foto da tela ANTERIOR por cima de tudo — nenhum clique passa
          // em lugar nenhum da página até recarregar. Forçar o fim depois
          // de 1s garante que a tela nunca fique presa nisso.
          const destravar = setTimeout(() => transicao.skipTransition(), 1000);
          transicao.finished.finally(() => clearTimeout(destravar)).catch(() => {});
        } catch {
          reorder();
        }
      } else {
        reorder();
      }
      // O painel aberto atualiza mesmo quando a conversa sai do filtro —
      // sumir da lista lateral não pode fechar o que a pessoa está lendo.
      if (selectedIdRef.current === updated.id) {
        setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
      }
      // As abas fechadas também: a conversa entra ou sai de cada uma na
      // hora, e trocar de aba mostra a lista já certa (ver
      // `inboxListCache.aplicarConversa`).
      inboxListCache.aplicarConversa(chaveDaSessao, updated, user.id);
      const guardada = conversationCache.get(chaveDaSessao, updated.id);
      if (guardada) guardada.detail = { ...guardada.detail, ...updated };
      // Mensagem nova numa conversa que ainda não está na memória: traz
      // antes de alguém clicar, pra ela abrir sem "carregando".
      if (updated.unreadCount > 0) preCarregar(updated.id, { adiar: true });
      agendarContagem();
    };

    const onMessageCreated = ({
      conversationId,
      message,
    }: {
      conversationId: string;
      message: ConversationMessage;
    }) => {
      if (selectedIdRef.current !== conversationId) {
        // Conversa fechada: a mensagem vai pra memória dela, e abrir depois
        // não precisa esperar o servidor (ver `conversationCache.emDia`).
        conversationCache.anexarMensagem(chaveDaSessao, conversationId, message);
        if (preCarregando.current.has(conversationId)) {
          chegouDuranteABusca.current.add(conversationId);
        }
        return;
      }
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

        conversationCache.patchMessages(chaveDaSessao, conversationId, messages);
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
      if (selectedIdRef.current !== conversationId) {
        conversationCache.atualizarMensagem(chaveDaSessao, conversationId, message.id, message);
        return;
      }
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
      if (selectedIdRef.current !== conversationId) {
        conversationCache.atualizarMensagem(chaveDaSessao, conversationId, messageId, { status });
        return;
      }
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

    const onDisconnect = () => {
      conversationCache.perdeuConexao();
      inboxListCache.perdeuConexao();
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("canal.historico", onCanalHistorico);
    socket.on("conversation.updated", onConversationUpdated);
    socket.on("message.created", onMessageCreated);
    socket.on("message.updated", onMessageUpdated);
    socket.on("message.status", onMessageStatus);
    socket.on("message.transcrita", onMessageTranscrita);

    return () => {
      agrupadorDeHistorico.cancelar();
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("canal.historico", onCanalHistorico);
      socket.off("conversation.updated", onConversationUpdated);
      socket.off("message.created", onMessageCreated);
      socket.off("message.updated", onMessageUpdated);
      socket.off("message.status", onMessageStatus);
      socket.off("message.transcrita", onMessageTranscrita);
    };
    // Sem `filters` nas dependências: os ouvintes leem o recorte atual
    // pelo ref, e assim o efeito é montado uma vez só em vez de desligar e
    // religar cinco ouvintes a cada clique na barra de filtros.
  }, [
    socket,
    loadConversations,
    loadDetail,
    agendarContagem,
    chaveDaSessao,
    user.id,
    flusharReconciliacaoDeHistorico,
    sincronizar,
    loadCounts,
    aquecer,
    preCarregar,
  ]);

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

    const optimistic: ConversationMessage = {
      id: optimisticId,
      // A chave de tela nasce aqui e acompanha a mensagem até o fim: é ela
      // que impede o balão de ser remontado (e reanimado) quando o id
      // provisório der lugar ao do servidor.
      clientKey: optimisticId,
      conversationId: selectedId,
      senderType: "AGENT",
      // Com o nome e o id de quem escreve desde o primeiro instante: o
      // servidor sempre devolve os dois (ver `comNomeDeQuemEnviou`), e o
      // balão otimista sem eles ganhava o nome em cima quando a versão real
      // chegava, um segundo depois — a "piscada" depois de enviar.
      senderId: user.id,
      senderName: user.name,
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
      senderId: user.id,
      senderName: user.name,
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
      // A mensagem marcada pra responder vale pro anexo também — antes ela
      // ficava de fora, e a foto saía solta.
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

    const citada = replyTo?.id;
    setDetail((prev) => (prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev));
    setReplyTo(null);

    // Sem travar o compositor: o upload pode levar segundos e prender o
    // botão de enviar fazia a tela parecer congelada. O andamento aparece
    // na conversa, e a pessoa já pode escrever a próxima mensagem.
    try {
      const body = new FormData();
      body.append("file", file);
      if (caption) body.append("caption", caption);
      if (citada) body.append("replyToId", citada);
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
      {/* No celular só UMA das duas colunas existe por vez.

          A coluna da lista era `hidden md:flex`, e o painel de conversa
          ficava sozinho na tela dizendo "escolha uma conversa na lista ao
          lado" — uma lista que ali não existia. O Inbox inteiro era um beco
          sem saída no telefone.

          Agora a conversa escolhida é o que decide: sem nenhuma, a lista
          ocupa a tela; com uma, ela dá lugar ao atendimento, e a seta no
          cabeçalho volta. É como todo mensageiro se comporta em tela
          estreita, e no desktop nada muda — as duas convivem a partir de
          `md`. */}
      <div
        className={cn(
          "min-h-0 flex-col border-r md:flex",
          selectedId ? "hidden" : "flex",
        )}
      >
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
          onPreCarregar={preCarregar}
          onVisiveis={preCarregarVisiveis}
          relogio={relogio}
          saindo={saindoDaLista}
        />
      </div>
      {/* O outro lado da mesma alternância: sem conversa escolhida, o
          painel some no celular pra a lista poder ocupar a tela. O estado
          vazio dele ("nenhuma conversa aberta") continua valendo no
          desktop, onde a lista está do lado e a frase faz sentido. */}
      <div
        className={cn(
          "min-h-0 min-w-0 flex-col md:flex",
          selectedId ? "flex" : "hidden",
        )}
      >
      {/* Remontar ao trocar de conversa zera rascunho e busca — que é o
          esperado: rascunho de uma conversa não pode aparecer na outra. */}
      <ChatPanel
        key={selectedId ?? "vazio"}
        // Nunca a conversa de outro id: no render da troca, `detail` ainda
        // pode ser a anterior.
        conversation={detail?.id === selectedId ? detail : null}
        loading={Boolean(selectedId) && detail?.id !== selectedId}
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
      </div>
      {telaLarga ? (
        <div className="hidden overflow-y-auto border-l xl:block">
          <CustomerPanel conversation={detail} />
        </div>
      ) : null}
    </div>
    </TranscricaoDeAudioProvider>
  );
}
