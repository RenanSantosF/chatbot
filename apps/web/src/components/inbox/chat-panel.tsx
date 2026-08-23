"use client";

import {
  ArrowDown,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  MessagesSquare,
  Paperclip,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/empty-state";
import { useSession } from "@/components/session-provider";
import { useRealtime } from "@/components/realtime-provider";
import { avatarColor, initials } from "@/lib/avatar";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/priority";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { AssignmentActions } from "./assignment-actions";
import { MessageBubble } from "./message-bubble";
import { QuickReplyPicker, termoDoAtalho } from "./quick-reply-picker";
import { TagChip, TagPicker } from "./tag-picker";
import { AttachmentComposer } from "./attachment-composer";
import { EmojiPicker } from "./emoji-picker";
import { ForwardDialog } from "./forward-dialog";
import { VoiceRecorder } from "./voice-recorder";
import type {
  ConversationDetail,
  ConversationMessage,
  ConversationPriority,
} from "@/lib/types";

/**
 * Rótulo do separador de dia, no mesmo espírito do WhatsApp: os dois dias
 * mais recentes ganham nome, o resto vira data. Comparar pela data local
 * (não pelo ISO em UTC) importa: uma mensagem de 21h no Brasil já é "amanhã"
 * em UTC e cairia no balde errado.
 */
function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  const diffDays = Math.round((startOfDay(today) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) return date.toLocaleDateString("pt-BR", { weekday: "long" });
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function sameDay(a: string, b: string): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function DaySeparator({ label }: { label: string }) {
  return (
    // Sem `sticky`: grudado no topo ele passava POR CIMA do texto da
    // primeira mensagem do dia. Separador que tapa conteúdo não separa
    // nada — melhor ocupar a própria linha.
    <div className="flex justify-center py-2">
      <span className="rounded-full bg-bubble-in px-3 py-1 text-xs font-medium text-muted-foreground capitalize shadow-xs">
        {label}
      </span>
    </div>
  );
}

/**
 * Onde a leitura parou da última vez.
 *
 * Diferente do separador de dia: aquele é uma marca do calendário, este é
 * uma marca pessoal e some quando a conversa é reaberta. Por isso a linha
 * colorida atravessando a conversa inteira — quem volta a uma conversa com
 * quarenta mensagens novas precisa achar esse ponto de relance, sem ler.
 */
function UnreadDivider({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-2 py-2" role="separator">
      <span className="h-px flex-1 bg-primary/40" />
      <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
        {count === 1 ? "1 mensagem não lida" : `${count} mensagens não lidas`}
      </span>
      <span className="h-px flex-1 bg-primary/40" />
    </div>
  );
}

/**
 * Prioridade num seletor só, com um ponto da cor atual. Antes eram quatro
 * botões lado a lado, que somados a "Assumir", "Resolver" e "Reativar IA"
 * enchiam o cabeçalho de coisa clicável competindo pela atenção.
 */
function PriorityPicker({
  value,
  onChange,
}: {
  value: ConversationPriority;
  onChange: (priority: ConversationPriority) => void;
}) {
  const meta = PRIORITY_META[value];
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("size-2 shrink-0 rounded-full", meta.dot)} aria-hidden />
      <SelectField
        title="Prioridade da conversa"
        className="w-28"
        value={value}
        onChange={(next) => onChange(next as ConversationPriority)}
        options={PRIORITY_ORDER.map((priority) => ({
          value: priority,
          label: PRIORITY_META[priority].label,
        }))}
      />
    </div>
  );
}

/** Três bolinhas pulsando, no ritmo de "digitando" — carregamento que não
 *  finge ser conteúdo, só diz que algo está a caminho. */
function ChatLoading() {
  return (
    <div className="flex items-center gap-1.5" role="status" aria-label="Carregando conversa">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-2.5 animate-[pulsando_1s_ease-in-out_infinite] rounded-full bg-foreground/35"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </div>
  );
}

export function ChatPanel({
  conversation,
  loading,
  sending,
  onSend,
  onRefresh,
  onResolve,
  onReopen,
  onChangePriority,
  onSendFile,
  replyTo,
  hasOlder,
  onLoadOlder,
  onReply,
  onCancelReply,
  onReact,
  onRead,
  onDelete,
  onClose,
  podeEnviarEncerrada,
}: {
  conversation: ConversationDetail | null;
  /** Há conversa escolhida, mas os dados ainda estão vindo. */
  loading?: boolean;
  sending: boolean;
  onSend: (content: string) => Promise<void>;
  /** Recarrega a conversa depois de assumir/aceitar/recusar/transferir. */
  onRefresh: () => void;
  onResolve: () => Promise<void>;
  onReopen: () => Promise<void>;
  onChangePriority: (priority: ConversationPriority) => Promise<void>;
  onSendFile: (file: File, caption?: string) => Promise<void>;
  replyTo: ConversationMessage | null;
  hasOlder: boolean;
  onLoadOlder: () => Promise<void>;
  onReply: (message: ConversationMessage) => void;
  onCancelReply: () => void;
  onReact: (messageId: string, emoji: string) => Promise<void>;
  /** Chamada quando o fim da conversa aparece na tela. */
  onRead: () => void;
  onDelete: (messageId: string) => Promise<void>;
  /** Fecha a conversa e volta pro estado vazio (Esc). */
  onClose?: () => void;
  /** A empresa deixa responder em conversa encerrada (reabrindo)? */
  podeEnviarEncerrada: boolean;
}) {
  const { user } = useSession();
  const { canal } = useRealtime();
  const [draft, setDraft] = useState("");
  /**
   * Esc dispensou o seletor de respostas rápidas nesta digitação.
   *
   * O seletor é derivado do rascunho ("/pix" abre), então sem esta trava o
   * Esc não teria como fechá-lo: o texto continua na tela e ele reabriria
   * no mesmo quadro. Volta a valer assim que a pessoa digita de novo.
   */
  const [atalhoDispensado, setAtalhoDispensado] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [needle, setNeedle] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [forwarding, setForwarding] = useState<ConversationMessage | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  // O rodapé da conversa está à vista? Decide se mensagem nova arrasta a
  // tela e se a conversa conta como lida.
  const [pertoDoFim, setPertoDoFim] = useState(true);
  // Resolver e Reabrir mexem no estado da conversa e passam por rede. Sem
  // sinal de espera, o clique parecia não ter efeito e a pessoa clicava de
  // novo — resolvendo uma conversa que já tinha resolvido.
  const [mudandoEstado, setMudandoEstado] = useState(false);
  // Mensagem escolhida pra apagar — o diálogo só existe enquanto ela existe.
  const [apagando, setApagando] = useState<ConversationMessage | null>(null);

  async function comEspera(acao: () => Promise<void>) {
    setMudandoEstado(true);
    try {
      await acao();
    } finally {
      setMudandoEstado(false);
    }
  }
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const firstPaintRef = useRef(true);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);

  /**
   * A linha que acabou de ser citada, acendendo.
   *
   * Dura meio segundo: o suficiente pra o olho registrar que o gesto pegou
   * naquela mensagem, curto o bastante pra não virar destaque permanente
   * numa conversa que a pessoa continua lendo.
   */
  const [linhaPiscando, setLinhaPiscando] = useState<string | null>(null);
  const piscadaRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function piscarLinha(messageId: string) {
    if (piscadaRef.current) clearTimeout(piscadaRef.current);
    setLinhaPiscando(messageId);
    piscadaRef.current = setTimeout(() => setLinhaPiscando(null), 500);
  }

  useEffect(
    () => () => {
      if (piscadaRef.current) clearTimeout(piscadaRef.current);
    },
    [],
  );

  /**
   * O cursor já no campo quando a conversa abre.
   *
   * Abrir uma conversa é sempre o começo de "vou responder isto". Obrigar
   * um clique no campo antes de digitar é um passo que existe em todo
   * atendimento, o dia inteiro — e ninguém abre uma conversa pra olhar.
   *
   * Roda quando o COMPOSITOR aparece, não na montagem do painel. A
   * diferença decidia se funcionava: abrindo uma conversa a partir do
   * estado vazio, o painel monta mostrando o carregamento e o campo ainda
   * não existe — o foco caía no nada. Trocando de uma conversa pra outra
   * ele funcionava por acaso, porque o cache pinta a conversa no mesmo
   * quadro da montagem.
   *
   * O painel é remontado a cada troca (key={selectedId} no Inbox), então o
   * `jaFocou` reinicia sozinho a cada conversa aberta.
   */
  const jaFocou = useRef(false);
  useEffect(() => {
    if (jaFocou.current || !conversation) return;
    // No celular o foco automático abre o teclado por cima da conversa,
    // tapando justamente o que a pessoa acabou de abrir pra ler.
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const campo = composerRef.current;
    if (!campo || campo.disabled) return;

    jaFocou.current = true;
    campo.focus();
  }, [conversation]);

  /**
   * Onde a leitura estava quando o "carregar mensagens anteriores" foi
   * clicado.
   *
   * Carregar histórico é a única operação que faz o conteúdo crescer PRA
   * CIMA. O navegador mantém o `scrollTop` numérico, mas tudo o que estava
   * naquela altura desceu quarenta mensagens — o efeito é a tela saltar
   * sozinha. Guardando a altura de antes dá pra somar a diferença e deixar
   * a mensagem que a pessoa estava lendo exatamente onde ela estava.
   */
  const ancoraRef = useRef<{ altura: number; topo: number } | null>(null);
  const topoRef = useRef<HTMLDivElement | null>(null);
  /**
   * Avisa o efeito de rolagem que esta atualização foi histórico antigo
   * entrando, não mensagem nova chegando.
   *
   * Era o defeito: aquele efeito reage ao TAMANHO da lista, e uma das
   * condições pra descer é "a última mensagem é nossa". Como quase toda
   * conversa termina com uma resposta da empresa, clicar em "carregar
   * anteriores" caía nessa condição e jogava a tela lá pro fim — o oposto
   * exato do que o botão pede.
   */
  const pularIdaAoFimRef = useRef(false);
  /** A pessoa já rolou nesta conversa? Zera a cada conversa aberta. */
  const jaRolouRef = useRef(false);
  const [carregandoAnteriores, setCarregandoAnteriores] = useState(false);

  /**
   * Esc fecha o que estiver aberto, um de cada vez.
   *
   * A ordem é a de "quanto isso está no meu caminho agora": primeiro a
   * confirmação de apagar e o encaminhamento, que são janelas por cima de
   * tudo; depois a busca dentro da conversa; por último a citação presa no
   * compositor.
   *
   * A conversa é a ÚLTIMA camada, e só sai quando não há rascunho: Esc é o
   * gesto de desfazer o último passo, e perder o que já foi escrito por uma
   * tecla seria caro demais pra quem só queria cancelar a resposta citada.
   *
   * As camadas que este componente não conhece — a foto ampliada, o painel
   * de emojis, a tira de reações, o seletor de etiquetas — se defendem
   * sozinhas: cada uma escuta o Esc na fase de CAPTURA e o barra ali. Tem
   * que ser na captura, e não na bolha: os ouvintes estão todos no
   * `document`, e este aqui foi registrado primeiro, então na bolha ele
   * rodaria antes e a conversa fecharia junto com a foto — que era
   * exatamente o defeito relatado.
   */
  useEffect(() => {
    const aoTeclar = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (termoDoAtalho(draft) !== null && !atalhoDispensado) {
        return setAtalhoDispensado(true);
      }
      if (apagando) return setApagando(null);
      if (forwarding) return setForwarding(null);
      if (pendingFile) return setPendingFile(null);
      if (searchOpen) {
        setSearchOpen(false);
        setNeedle("");
        return;
      }
      if (replyTo) return onCancelReply();

      // Nada aberto por cima: fecha a conversa e volta pro "nenhuma
      // conversa aberta", igual ao WhatsApp Web. Só quando não há rascunho
      // — perder o que já foi escrito por uma tecla seria caro, e quem
      // digitou alguma coisa quase nunca quis sair.
      if (!draft.trim()) onClose?.();
    };

    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [
    apagando,
    forwarding,
    pendingFile,
    searchOpen,
    replyTo,
    onCancelReply,
    draft,
    onClose,
    atalhoDispensado,
  ]);

  const carregarAnteriores = useCallback(async () => {
    const area = scrollAreaRef.current;
    if (!area || carregandoAnteriores) return;

    ancoraRef.current = { altura: area.scrollHeight, topo: area.scrollTop };
    pularIdaAoFimRef.current = true;
    setCarregandoAnteriores(true);
    try {
      await onLoadOlder();
    } finally {
      setCarregandoAnteriores(false);
    }
  }, [carregandoAnteriores, onLoadOlder]);

  /*
   * O histórico sobe sozinho quando a rolagem chega no topo.
   *
   * Antes só havia o botão, e ele bastava quando uma conversa tinha
   * dezenas de mensagens. Com o histórico do aparelho importado, voltar
   * meses vira dezenas de cliques — e ninguém espera isso de um chat.
   *
   * A margem grande antecipa: começa a buscar antes de a pessoa encostar
   * no topo, de modo que os balões antigos costumam já estar lá quando ela
   * chega. A posição é preservada logo abaixo, no efeito de layout.
   */
  useEffect(() => {
    const topo = topoRef.current;
    const area = scrollAreaRef.current;
    /*
     * Só depois de a pessoa sair do fim.
     *
     * Ao abrir, a conversa ainda está sendo posicionada e o topo passa
     * pela área visível por um instante — com a margem folgada, isso
     * bastava pra disparar a busca. As mensagens antigas entravam, a
     * âncora recolocava a tela "onde estava", e a conversa que tinha
     * acabado de descer aparecia no meio do histórico. Era o pulo de dois
     * segundos depois de abrir.
     *
     * `pertoDoFim` resolve pelo significado, não por tempo: quem está no
     * rodapé não está lendo o passado, então não há o que carregar.
     */
    if (!topo || !area || !hasOlder || pertoDoFim) return;

    const observer = new IntersectionObserver(
      ([entrada]) => {
        if (entrada.isIntersecting) void carregarAnteriores();
      },
      { root: area, rootMargin: "400px 0px 0px 0px", threshold: 0 },
    );

    observer.observe(topo);
    return () => observer.disconnect();
    // `carregandoAnteriores` entra de propósito: terminada uma busca, o
    // observador é refeito e, se o topo ainda estiver à vista, pede a
    // página seguinte — que é o que faz a rolagem contínua funcionar.
  }, [hasOlder, carregarAnteriores, conversation?.id, pertoDoFim]);

  useEffect(() => {
    jaRolouRef.current = false;

    const area = scrollAreaRef.current;
    if (!area) return;

    // `wheel` e `touchmove`, não `scroll`: o posicionamento da abertura é
    // programático e dispara `scroll` sozinho, o que marcaria como se a
    // pessoa tivesse rolado antes mesmo de a conversa aparecer.
    const marcar = () => {
      jaRolouRef.current = true;
    };
    area.addEventListener("wheel", marcar, { passive: true });
    area.addEventListener("touchmove", marcar, { passive: true });
    return () => {
      area.removeEventListener("wheel", marcar);
      area.removeEventListener("touchmove", marcar);
    };
  }, [conversation?.id]);

  /*
   * Digitar em qualquer lugar escreve no campo de mensagem.
   *
   * Com a conversa aberta, o teclado pertence a ela. Antes era preciso
   * clicar no campo primeiro, e quem vinha de clicar num balão, numa
   * etiqueta ou no painel do cliente digitava a resposta inteira no vazio
   * — sem nada aparecer na tela e sem entender por quê.
   *
   * O que NÃO é sequestrado: teclas de atalho (com Ctrl, Alt ou Meta),
   * navegação (setas, Tab, Esc, F1-F12) e qualquer digitação que já esteja
   * num campo de verdade — a busca da conversa, uma nota do cliente, o
   * seletor de etiqueta. Roubar o foco desses seria trocar um incômodo
   * por outro pior.
   */
  useEffect(() => {
    if (!conversation) return;

    function aoDigitar(evento: KeyboardEvent) {
      if (evento.ctrlKey || evento.metaKey || evento.altKey) return;
      // Uma tecla só, e imprimível: "a" entra, "Enter" e "ArrowUp" não.
      if (evento.key.length !== 1) return;

      const alvo = evento.target as HTMLElement | null;
      if (
        alvo?.isContentEditable ||
        alvo?.tagName === "INPUT" ||
        alvo?.tagName === "TEXTAREA" ||
        alvo?.tagName === "SELECT"
      ) {
        return;
      }

      /*
       * Nem quando há uma janela por cima.
       *
       * A foto ampliada e as caixas de confirmação cobrem a conversa
       * inteira, e o compositor continua vivo atrás delas. Sem esta
       * conferência, quem apertasse uma tecla com a foto aberta começava a
       * escrever uma mensagem que não estava vendo — e só descobria ao
       * fechar a imagem. `aria-modal` é o que essas janelas já declaram
       * pra dizer justamente isso: nada atrás de mim está valendo.
       */
      if (document.querySelector('[aria-modal="true"]')) return;

      const campo = composerRef.current;
      if (!campo || campo.disabled) return;

      // Só o foco: a própria tecla chega ao campo pelo evento seguinte, e
      // inseri-la à mão aqui a escreveria duas vezes.
      campo.focus();
    }

    document.addEventListener("keydown", aoDigitar);
    return () => document.removeEventListener("keydown", aoDigitar);
  }, [conversation?.id, conversation]);

  // useLayoutEffect, não useEffect: a correção precisa acontecer no mesmo
  // quadro em que os balões antigos entram. Um quadro depois já teria
  // aparecido como um salto.
  useLayoutEffect(() => {
    const ancora = ancoraRef.current;
    const area = scrollAreaRef.current;
    if (!ancora || !area) return;

    ancoraRef.current = null;
    area.scrollTop = ancora.topo + (area.scrollHeight - ancora.altura);
  }, [conversation?.messages.length]);

  // Ids das mensagens que casam com a busca, na ordem da conversa. Roda
  // sobre o que já está carregado — que é o mesmo que o WhatsApp Web faz
  // enquanto você não rola pra trás.
  const matches = useMemo(() => {
    const term = needle.trim().toLowerCase();
    if (!term || !conversation) return [] as string[];
    return conversation.messages
      .filter((message) => message.content?.toLowerCase().includes(term))
      .map((message) => message.id);
  }, [needle, conversation]);

  const currentMatchId = matches[matchIndex] ?? null;

  // Quais balões podem animar a entrada.
  //
  // A queixa de "a tela abre rolando com animação" não era o scroll: era
  // que TODO balão tinha `animate-in slide-in`, então abrir uma conversa
  // disparava trinta animações de uma vez e o conjunto parecia rolagem.
  // Aqui só anima o que chegou depois que o painel já estava aberto.
  //
  // A varredura é de trás pra frente e para no primeiro balão conhecido:
  // assim mensagem nova (que entra no fim) anima, e histórico antigo
  // carregado pelo "ver anteriores" (que entra no começo) não.
  // O critério é a hora: anima só o que foi escrito depois que este painel
  // abriu. O painel é remontado a cada troca de conversa (key={selectedId}
  // no Inbox), então este marco é sempre "quando esta conversa apareceu".
  //
  // Comparar por hora, e não por "id que eu já tinha visto", resolve de
  // graça o histórico carregado pelo "ver anteriores": aquelas mensagens
  // são antigas, então entram sem animação nenhuma, que é o certo.
  const [abertoEm] = useState(() => Date.now());

  /**
   * Quantas mensagens estavam por ler quando esta conversa foi aberta.
   *
   * Congelado no primeiro render (o painel é remontado a cada troca de
   * conversa, então "primeiro render" é sempre "esta abertura"). Tem que
   * ser congelado: assim que o rodapé aparece o contador zera no servidor,
   * e um marcador que sumisse junto não serviria pra nada — ele existe
   * justamente pra dizer "você parou de ler aqui" enquanto a pessoa lê.
   */
  const [naoLidasAoAbrir] = useState(() => conversation?.unreadCount ?? 0);

  /**
   * Id da primeira mensagem por ler, que é onde a tarja entra.
   *
   * O contador do servidor conta mensagens de cliente, então a conta é
   * feita de trás pra frente pulando as nossas: numa troca "cliente,
   * empresa, cliente" com duas não lidas, a tarja precisa ficar antes da
   * primeira das duas do cliente, não três mensagens acima.
   */
  const primeiraNaoLida = useMemo(() => {
    if (!conversation || naoLidasAoAbrir === 0) return null;
    let restantes = naoLidasAoAbrir;
    for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
      const mensagem = conversation.messages[i];
      if (mensagem.senderType !== "CUSTOMER") continue;
      restantes -= 1;
      if (restantes === 0) return mensagem.id;
    }
    // Menos mensagens carregadas que não lidas: a conversa foi aberta numa
    // página antiga do histórico. Marcar a primeira da página seria mentira.
    return null;
  }, [conversation, naoLidasAoAbrir]);

  useEffect(() => {
    if (!currentMatchId) return;
    document
      .querySelector(`[data-message-id="${currentMatchId}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentMatchId]);

  useEffect(() => {
    // Não puxa pro fim enquanto a pessoa está navegando pelos resultados.
    if (currentMatchId) return;

    // Nem quando o que cresceu foi o começo da lista: quem pediu histórico
    // quer ficar onde está, e a âncora acima já recolocou a tela no lugar.
    if (pularIdaAoFimRef.current) {
      pularIdaAoFimRef.current = false;
      return;
    }

    const area = scrollAreaRef.current;
    if (!area) return;

    // "Abrindo" é uma JANELA, não um quadro.
    //
    // A conversa é pintada primeiro do cache e reconciliada logo depois com
    // a resposta do servidor. Quando as duas versões têm contagens
    // diferentes (chegou mensagem nova enquanto a conversa estava fechada),
    // o efeito rodava uma segunda vez já fora do "primeiro quadro" e
    // deslizava — era a rolagem animada que aparecia em ALGUMAS conversas,
    // justamente as que estavam em cache.
    //
    // Abrir uma conversa nunca é animado: a pessoa quer chegar no fim, não
    // assistir a viagem até lá.
    const primeira = firstPaintRef.current || Date.now() - abertoEm < 1200;

    // Mensagem do CLIENTE só arrasta a tela se quem está lendo já estava no
    // fim — ler o histórico com a conversa ativa era impossível quando toda
    // mensagem que chegava puxava a página de volta pro rodapé.
    //
    // Mensagem NOSSA sempre desce. Quem acabou de escrever quer ver o que
    // escreveu: mandar do meio do histórico e a tela não se mexer parece
    // que a mensagem não saiu.
    const mensagens = conversation?.messages ?? [];
    const ultima = mensagens[mensagens.length - 1];
    const foiEuQueMandei = Boolean(ultima) && ultima.senderType !== "CUSTOMER";
    if (!primeira && !pertoDoFim && !foiEuQueMandei) return;
    firstPaintRef.current = false;

    // Mexe no scrollTop do container em vez de scrollIntoView: este último
    // respeita `scroll-behavior` herdado e continuava animando na abertura,
    // que era exatamente o que incomodava. Aqui a primeira pintura salta
    // seco pro fim e só mensagem nova desliza.
    const irAoFim = () => {
      // Enquanto ninguém rolou nesta conversa, o salto é seco: abrir é
      // chegar, não assistir a viagem. A janela de tempo sozinha não dava
      // conta — a reconciliação com o servidor às vezes cai depois dela, e
      // aí a abertura deslizava.
      if (primeira || !jaRolouRef.current) area.scrollTop = area.scrollHeight;
      else area.scrollTo({ top: area.scrollHeight, behavior: "smooth" });
    };

    irAoFim();
    // De novo no quadro seguinte: imagem e anexo só ganham altura depois
    // de pintar, e sem isso a conversa abria parando pouco antes do fim.
    const quadro = requestAnimationFrame(irAoFim);
    return () => cancelAnimationFrame(quadro);
    // `pertoDoFim` de propósito fora das dependências: ele muda a cada
    // rolagem, e reagir a isso faria a tela se empurrar sozinha enquanto a
    // pessoa rola. Aqui ele é só uma condição consultada quando chega
    // mensagem nova.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id, conversation?.messages.length, currentMatchId]);

  /**
   * Marca como lida quando o rodapé da conversa aparece de verdade.
   *
   * É a diferença entre "abri a conversa" e "li a mensagem": quem clica na
   * conversa e fica no meio do histórico não viu o que chegou agora, e o
   * cliente não deveria receber tique azul por isso.
   */
  useEffect(() => {
    const fim = bottomRef.current;
    const area = scrollAreaRef.current;
    if (!fim || !area || !conversation) return;

    const observer = new IntersectionObserver(
      ([entrada]) => {
        setPertoDoFim(entrada.isIntersecting);
        if (entrada.isIntersecting) onRead();
      },
      // A margem trata o fim como "visível" um pouco antes de encostar:
      // exigir o pixel exato deixava a conversa por ler quando a última
      // mensagem estava inteira na tela mas o rodapé, não.
      { root: area, rootMargin: "0px 0px 120px 0px", threshold: 0 },
    );

    observer.observe(fim);
    return () => observer.disconnect();
  }, [conversation?.id, onRead, conversation]);

  if (!conversation) {
    return (
      <div className="chat-wallpaper flex min-h-0 flex-1 items-center justify-center p-6">
        {/* Carregando é diferente de vazio: quando há conversa escolhida
            mas os dados ainda não chegaram, mostrar "escolha uma conversa"
            é mentira e assusta. */}
        {loading ? (
          <ChatLoading />
        ) : (
          <EmptyState
            icon={MessagesSquare}
            title="Nenhuma conversa aberta"
            description="Escolha uma conversa na lista ao lado para começar a atender."
          />
        )}
      </div>
    );
  }

  const isResolved = conversation.status === "RESOLVED" || conversation.status === "CLOSED";
  // Encerrada não é o mesmo que travada. Quando a empresa libera, responder
  // reabre o atendimento sozinho (ver reabrirSePreciso na API) — do lado do
  // cliente é uma conversa de WhatsApp como outra qualquer, e obrigar o
  // atendente a reabrir antes de escrever seria burocracia só nossa.
  /*
   * O WhatsApp da empresa está fora do ar.
   *
   * Trancar o compositor aqui é a diferença entre avisar e impedir. Com o
   * campo liberado, quem atende digitava, apertava enviar, via o tique de
   * sempre e seguia adiante — e nada saía. Um aviso que a pessoa pode
   * atravessar sem perceber não é um aviso, é um enfeite.
   *
   * E não existe fila de reenvio de propósito: a mensagem barrada aqui NÃO
   * vai sair sozinha quando a sessão voltar. Guardar texto pra disparar
   * depois seria pior que não enviar — o cliente receberia horas depois uma
   * resposta escrita para outro momento, sem ninguém revisar se ela ainda
   * faz sentido.
   */
  const canalForaDoAr = canal !== null && canal.estado !== "CONECTADO";
  const composicaoTravada = (isResolved && !podeEnviarEncerrada) || canalForaDoAr;

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) setPendingFile(file);
  }

  /**
   * Ctrl+V com imagem na área de transferência cai aqui. Só intercepta
   * quando há arquivo — colar texto continua funcionando normalmente.
   */
  function handlePaste(event: React.ClipboardEvent) {
    const file = Array.from(event.clipboardData.files)[0];
    if (!file) return;
    event.preventDefault();
    setPendingFile(file);
  }

  /**
   * Reenvia uma figurinha que já passou por esta conta.
   *
   * Baixa o binário e o manda pelo MESMO caminho de qualquer anexo, em vez
   * de uma rota de "reenviar por id". Um segundo caminho de envio teria
   * que repetir o balão otimista, o tique de entrega e o tempo real — e
   * envelheceria sozinho na primeira vez que o de cima mudasse.
   *
   * O nome do arquivo termina em `.webp` porque é o mimetype que decide,
   * dos dois lados, que aquilo é figurinha e não foto.
   */
  async function reenviarFigurinha(mediaId: string) {
    try {
      const resposta = await fetch(
        `/api/whatsapp/media/${encodeURIComponent(mediaId)}`,
      );
      if (!resposta.ok) throw new Error(String(resposta.status));

      const blob = await resposta.blob();
      await onSendFile(
        new File([blob], "figurinha.webp", { type: "image/webp" }),
      );
    } catch {
      toast.error("Não deu pra enviar a figurinha. Tente de novo.");
    }
  }

  async function handleSubmit(event?: React.SyntheticEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content) return;

    setDraft("");
    // O foco volta ANTES do envio terminar, não depois.
    //
    // O envio é otimista: o balão já apareceu na conversa e a viagem até o
    // servidor não interessa a quem está digitando. Esperar o `await` pra
    // devolver o cursor obrigava a clicar no campo de novo pra mandar a
    // segunda mensagem — e conversa de atendimento é feita de mensagens
    // curtas em sequência, não de um parágrafo só.
    composerRef.current?.focus();

    await onSend(content);
  }

  return (
    // min-h-0 é obrigatório: um item flex nunca encolhe abaixo do próprio
    // conteúdo sem ele, e aí a lista de mensagens estica em vez de rolar,
    // empurrando cabeçalho e compositor pra fora da tela.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-card px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* A volta pra lista, no celular.

              Ali a conversa ocupa a tela inteira e a lista não existe ao
              lado — sem esta seta, quem abrisse um atendimento ficava
              preso nele. No desktop as duas colunas convivem e a seta
              seria um botão que não leva a lugar nenhum.

              É o mesmo `onClose` do Esc: fechar a conversa já era a ação
              certa, só não tinha como pedir com o dedo. */}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Voltar para a lista de conversas"
            onClick={() => onClose?.()}
            className="-ml-1 shrink-0 md:hidden"
          >
            <ArrowLeft className="size-5" />
          </Button>
          <Avatar className="size-9 shrink-0">
            <AvatarFallback className={cn("text-xs font-medium", avatarColor(conversation.customer.id))}>
              {initials(conversation.customer.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{conversation.customer.name}</p>
            <p className="truncate text-xs text-muted-foreground">{conversation.customer.phone}</p>
          </div>
          {/* Discretas e ao lado do nome: dizem do que se trata sem roubar a
              linha do cliente, que é o que a pessoa procura primeiro. */}
          {(conversation.tags ?? []).length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {(conversation.tags ?? []).map((tag) => (
                <TagChip key={tag.id} tag={tag} />
              ))}
            </div>
          ) : null}
        </div>
        {/* Sem `shrink-0`: ele existia pra as ações não serem espremidas
            pelo nome do cliente ao lado, e no computador continua sendo o
            que a falta de `flex-1` já garante. No celular ele fazia a
            fileira manter a largura de umas 430px e sair pela direita —
            "Resolver" ficava metade fora da tela, e ali não havia rolagem
            nenhuma pra alcançar o resto. Com ele fora, o `flex-wrap`
            finalmente pode fazer o que promete e quebrar a linha. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Buscar nesta conversa"
            title="Buscar nesta conversa"
            onClick={() => setSearchOpen((open) => !open)}
          >
            <Search className="size-4" />
          </Button>
          <TagPicker
            selecionadas={conversation.tags ?? []}
            onMarcar={async (tag) => {
              await apiFetch(`/conversations/${conversation.id}/tags/${tag.id}`, {
                method: "POST",
              });
              onRefresh();
            }}
            onDesmarcar={async (tag) => {
              await apiFetch(`/conversations/${conversation.id}/tags/${tag.id}`, {
                method: "DELETE",
              });
              onRefresh();
            }}
          />
          <PriorityPicker value={conversation.priority} onChange={onChangePriority} />
          {!isResolved && (
            <>
              {/* Assumir / Aceitar-Recusar / Transferir — nunca os três ao
                  mesmo tempo. Antes "Assumir" continuava visível depois de
                  assumida, e a pessoa clicava de novo achando que falhou. */}
              <AssignmentActions
                conversation={conversation}
                currentUserId={user.id}
                onChanged={onRefresh}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={mudandoEstado}
                onClick={() => void comEspera(onResolve)}
              >
                {mudandoEstado ? <Spinner className="size-3.5" /> : null}
                Resolver
              </Button>
            </>
          )}
          {isResolved && (
            <Button
              size="sm"
              variant="outline"
              disabled={mudandoEstado}
              onClick={() => void comEspera(onReopen)}
            >
              {mudandoEstado ? <Spinner className="size-3.5" /> : null}
              Reabrir
            </Button>
          )}
          {/* "Reativar IA" saiu do cabeçalho da conversa de propósito: quem
              decide se a IA atende é a configuração da empresa, não um
              botão ao lado de "Resolver". Ligar e desligar a IA no meio do
              atendimento, conversa a conversa, produzia estados que ninguém
              conseguia explicar depois — e a conversa reaberta pelo cliente
              já volta pra IA sozinha (ver reabrirParaAgrupamento na API). */}
        </div>
      </div>

      {searchOpen ? (
        <div className="flex items-center gap-2 bg-card px-3 py-2">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={needle}
              onChange={(event) => {
                setNeedle(event.target.value);
                setMatchIndex(0);
              }}
              placeholder="Buscar nesta conversa"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <span className="w-16 text-center text-xs text-muted-foreground tabular-nums">
            {needle.trim() ? `${matches.length ? matchIndex + 1 : 0}/${matches.length}` : ""}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Resultado anterior"
            disabled={matches.length < 2}
            onClick={() => setMatchIndex((i) => (i - 1 + matches.length) % matches.length)}
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Próximo resultado"
            disabled={matches.length < 2}
            onClick={() => setMatchIndex((i) => (i + 1) % matches.length)}
          >
            <ChevronDown className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Fechar busca"
            onClick={() => {
              setSearchOpen(false);
              setNeedle("");
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : null}

      <div
        ref={scrollAreaRef}
        // overflow-x-hidden: uma imagem ou tabela larga abria barra
        // horizontal na conversa inteira, e aí a régua vinha por cima do
        // compositor. A mídia se ajusta; o painel não escorrega.
        className="chat-wallpaper relative flex min-h-0 flex-1 flex-col gap-1.5 overflow-x-hidden overflow-y-auto p-4"
        onDragOver={(event) => {
          event.preventDefault();
          if (!composicaoTravada) setDragging(true);
        }}
        onDragLeave={(event) => {
          // Só apaga o realce quando o ponteiro sai de verdade da área —
          // sem isso ele pisca ao passar por cima de cada balão.
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={composicaoTravada ? undefined : handleDrop}
        onMouseUp={(evento) => {
          // Clicar em qualquer canto vazio da conversa põe o cursor no
          // campo de mensagem — é o gesto de quem vai responder, e obrigar
          // a mirar no campo depois de já ter clicado na tela é atrito à
          // toa.
          //
          // Duas exceções, senão isto atrapalha mais do que ajuda: quem
          // está selecionando texto pra copiar não pode perder a seleção, e
          // clique em botão, link ou player de áudio pertence a eles.
          if (window.getSelection()?.toString()) return;
          if ((evento.target as HTMLElement).closest("button, a, audio, video, input")) {
            return;
          }
          composerRef.current?.focus();
        }}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/80 backdrop-blur-sm">
            <p className="text-sm font-medium">Solte o arquivo pra anexar</p>
          </div>
        ) : null}
        {/*
            O gatilho da rolagem pra cima.
            Fica ACIMA do botão, e é ele que faz o histórico subir sozinho
            ao chegar no topo — como no WhatsApp Web. O botão continua
            embaixo porque nem toda rolagem é suave: em aba de segundo
            plano, ou com o teclado, o topo pode ser alcançado sem o
            observador disparar, e aí a pessoa precisa de algo pra clicar.
        */}
        <div ref={topoRef} aria-hidden className="h-px" />
        {hasOlder ? (
          <div className="flex justify-center pb-2">
            <Button
              size="sm"
              variant="secondary"
              // Desabilitado enquanto busca: dois cliques seguidos pediam
              // duas páginas com o mesmo cursor e traziam o mesmo trecho
              // do histórico duas vezes.
              disabled={carregandoAnteriores}
              onClick={() => void carregarAnteriores()}
            >
              {carregandoAnteriores ? "Carregando…" : "Carregar mensagens anteriores"}
            </Button>
          </div>
        ) : null}
        {conversation.messages.map((message: ConversationMessage, index) => {
          const previous = conversation.messages[index - 1];
          const startsNewDay = !previous || !sameDay(previous.createdAt, message.createdAt);
          return (
            // `clientKey` antes do `id`: é o que mantém o MESMO elemento
            // quando o balão otimista vira a versão do servidor, em vez de
            // desmontar e remontar (e reanimar) no lugar.
            <div key={message.clientKey ?? message.id} className="contents">
              {startsNewDay ? <DaySeparator label={dayLabel(message.createdAt)} /> : null}
              {message.id === primeiraNaoLida ? (
                <UnreadDivider count={naoLidasAoAbrir} />
              ) : null}
              {/* A LINHA inteira recebe o duplo clique — assim responder
                  funciona em qualquer ponto vazio ao lado da mensagem, e
                  não só colado nela. Faixa posicionada por fora do balão
                  estourava a largura e abria barra horizontal. */}
              <div
                onDoubleClick={(event) => {
                  // Só o vazio: dentro do balão o gesto atrapalharia
                  // selecionar e copiar o texto.
                  if (event.target !== event.currentTarget) return;
                  onReply(message);
                  piscarLinha(message.id);
                }}
                title={message.senderType === "SYSTEM" ? undefined : "Clique duas vezes para responder"}
                className={cn(
                  // cursor-pointer só na faixa vazia: o balão volta pro
                  // cursor de texto (abaixo, no próprio balão) pra não
                  // atrapalhar quem quer selecionar e copiar.
                  //
                  // `select-none` na FAIXA, e não no balão: o duplo clique
                  // no vazio ao lado da mensagem selecionava o texto do
                  // balão vizinho, e a seleção fazia o navegador abrir o
                  // menu de atalho dele por cima da conversa. Selecionar
                  // continua funcionando dentro do balão, que é onde faz
                  // sentido (ver `select-text` no MessageBubble).
                  "flex w-full min-w-0 cursor-pointer rounded-lg transition-colors select-none",
                  message.senderType === "CUSTOMER" ? "justify-start" : "justify-end",
                  message.senderType === "SYSTEM" && "cursor-default justify-center",
                  // O eco do gesto: a linha inteira acende por um instante
                  // e apaga. Sem ele, o duplo clique só enche a barrinha de
                  // citação lá embaixo — longe de onde o olho estava.
                  linhaPiscando === message.id && "bg-primary/10",
                )}
              >
              <MessageBubble
                message={message}
                animar={new Date(message.createdAt).getTime() > abertoEm}
                highlight={needle.trim()}
                isCurrentMatch={message.id === currentMatchId}
                onReply={onReply}
                onReact={onReact}
                onForward={setForwarding}
                onDelete={setApagando}
              />
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />

        {/* Aparece só quando a pessoa está lendo o histórico. Sem ele, a
            escolha de não arrastar a tela deixaria mensagem nova chegando
            fora de vista e sem nenhum aviso. */}
        {!pertoDoFim ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label="Ir para a última mensagem"
            title="Ir para a última mensagem"
            onClick={() =>
              scrollAreaRef.current?.scrollTo({
                top: scrollAreaRef.current.scrollHeight,
                behavior: "smooth",
              })
            }
            className="sticky bottom-2 z-10 self-end rounded-full shadow-md duration-200 animate-in fade-in zoom-in-95"
          >
            <ArrowDown className="size-4" />
          </Button>
        ) : null}
      </div>

      <ForwardDialog
        message={forwarding}
        fromConversationId={conversation.id}
        onClose={() => setForwarding(null)}
      />

      <Sheet open={apagando !== null} onOpenChange={(aberto) => !aberto && setApagando(null)}>
        <SheetContent className="gap-0">
          <SheetHeader>
            <SheetTitle>Apagar mensagem</SheetTitle>
            <SheetDescription>
              Ela sai do painel e some para toda a equipe.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-4 px-4 py-2">
            {apagando?.content ? (
              <p className="line-clamp-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                {apagando.content}
              </p>
            ) : null}

            {/* O limite dito na cara, antes do clique. A API do WhatsApp não
                tem como apagar mensagem já entregue — só o aplicativo tem.
                Deixar isso implícito faria alguém apagar achando que o
                cliente deixaria de ver, que é o pior mal-entendido possível
                num sistema de atendimento. */}
            <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-pretty">
              <TriangleAlert className="mt-px size-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <span>
                A mensagem <strong>continua no celular do cliente</strong>. O WhatsApp não
                permite que sistemas apaguem o que já foi entregue — só o aplicativo, na
                mão de quem enviou.
              </span>
            </p>

            <SheetFooter className="px-0">
              <Button
                variant="destructive"
                onClick={() => {
                  const alvo = apagando;
                  setApagando(null);
                  if (alvo) void onDelete(alvo.id);
                }}
              >
                Apagar do painel
              </Button>
            </SheetFooter>
          </div>
        </SheetContent>
      </Sheet>

      {replyTo ? (
        <div className="flex items-center gap-2 bg-muted/60 px-3 py-2 duration-200 ease-out animate-in fade-in slide-in-from-bottom-2">
          <div className="min-w-0 flex-1 border-l-2 border-primary pl-2">
            <p className="text-[11px] font-medium text-primary">
              {replyTo.senderType === "CUSTOMER" ? "Cliente" : "Você"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {replyTo.content || "Anexo"}
            </p>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Cancelar resposta" onClick={onCancelReply}>
            <X className="size-4" />
          </Button>
        </div>
      ) : null}

      {pendingFile ? (
        <AttachmentComposer
          file={pendingFile}
          sending={false}
          onCancel={() => setPendingFile(null)}
          onSend={(caption) => {
            const file = pendingFile;
            setPendingFile(null);
            void onSendFile(file, caption);
          }}
        />
      ) : (
      /* Sem borda entre a conversa e o compositor: a troca de cor da
         superfície já marca a separação, que era o pedido.

         Sem botão de enviar: quem escreve o dia inteiro manda no Enter e
         nunca no clique, e o botão só ocupava o canto onde o microfone
         precisa estar. Enter envia, Shift+Enter quebra linha. */
      <>
      <QuickReplyPicker
        termo={atalhoDispensado ? null : termoDoAtalho(draft)}
        onEscolher={(resposta) => {
          setDraft(resposta.content);
          setAtalhoDispensado(true);
          composerRef.current?.focus();
          // O contador ordena a lista pelo que a equipe de fato usa. Falhar
          // aqui não pode atrapalhar quem está atendendo: o texto já está no
          // campo, e um número que não subiu não merece um aviso de erro.
          void apiFetch(`/quick-replies/${resposta.id}/uso`, { method: "POST" }).catch(
            () => {},
          );
        }}
      />
      <form onSubmit={handleSubmit} className="flex items-center gap-2 bg-card p-3">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Limpa o input pra o mesmo arquivo poder ser reenviado logo
            // depois — sem isso o onChange não dispara na segunda vez.
            event.target.value = "";
            if (file) setPendingFile(file);
          }}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Anexar arquivo"
          title="Anexar imagem, PDF, áudio ou vídeo"
          disabled={composicaoTravada || sending}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>
        <EmojiPicker
          disabled={composicaoTravada || sending}
          onPick={(emoji) => setDraft((atual) => atual + emoji)}
          onPickFigurinha={(mediaId) => void reenviarFigurinha(mediaId)}
        />
        <Input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            // Digitar de novo devolve o seletor: o Esc dispensa aquela
            // digitação, não o recurso.
            setAtalhoDispensado(false);
          }}
          onPaste={handlePaste}
          // O navegador guarda o que foi digitado em campo dentro de
          // formulário e oferece de volta na próxima vez. Num campo de
          // mensagem isso é constrangedor: a resposta dada a um cliente
          // aparece como sugestão enquanto se escreve pra outro — na frente
          // dele, se a tela estiver compartilhada. `off` desliga o
          // histórico; `new-password` é o reforço que o Chrome respeita
          // quando ignora o `off`.
          autoComplete="off"
          data-form-type="other"
          name="mensagem-nova"
          spellCheck
          enterKeyHint="send"
          onKeyDown={(event) => {
            // Um <input> já submeteria no Enter sozinho, mas só enquanto o
            // formulário tiver um botão de envio — que acabou de sair. Com
            // o tratamento explícito o comportamento para de depender
            // dessa regra do navegador.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSubmit(event);
            }
          }}
          ref={composerRef}
          placeholder={
            canalForaDoAr
              ? "WhatsApp desconectado — reconecte para responder"
              : composicaoTravada
                ? "Conversa encerrada — reabra para responder"
                : isResolved
                ? "Responder reabre o atendimento"
                : "Escreva uma mensagem..."
          }
          // Desabilitado SÓ quando a conversa está travada de verdade.
          //
          // `sending` também travava, e travar o campo é o que impedia
          // mandar duas mensagens seguidas: o campo apagava, ficava cinza
          // por uns instantes e ainda perdia o foco (o navegador tira o
          // foco de campo desabilitado). O envio é otimista — não há por
          // que esperar por ele pra continuar escrevendo.
          disabled={composicaoTravada}
          // Foco sem o anel verde. Num campo que fica selecionado o dia
          // inteiro, o realce da cor da marca vira um brilho constante no
          // canto da tela; a borda um pouco mais firme já diz onde o cursor
          // está, e o verde volta a significar alguma coisa quando aparece
          // em outro lugar.
          className="rounded-md focus-visible:border-foreground/30 focus-visible:ring-0"
        />
        {/* No canto onde estava o botão de enviar. O gravador se expande
            sobre o compositor enquanto grava, então precisa ser o último
            item da linha pra não empurrar o campo de texto. */}
        <VoiceRecorder disabled={composicaoTravada || sending} onRecorded={onSendFile} />
      </form>
      </>
      )}
    </div>
  );
}
