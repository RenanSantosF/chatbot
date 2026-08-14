"use client";

import {
  ArrowDown,
  ChevronDown,
  ChevronUp,
  MessagesSquare,
  Paperclip,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { avatarColor, initials } from "@/lib/avatar";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/priority";
import { cn } from "@/lib/utils";
import { AssignmentActions } from "./assignment-actions";
import { MessageBubble } from "./message-bubble";
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
  /** A empresa deixa responder em conversa encerrada (reabrindo)? */
  podeEnviarEncerrada: boolean;
}) {
  const { user } = useSession();
  const [draft, setDraft] = useState("");
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
    const area = scrollAreaRef.current;
    if (!area) return;

    const primeira = firstPaintRef.current;

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
      if (primeira) area.scrollTop = area.scrollHeight;
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
  const composicaoTravada = isResolved && !podeEnviarEncerrada;

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

  async function handleSubmit(event?: React.SyntheticEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    await onSend(content);
  }

  return (
    // min-h-0 é obrigatório: um item flex nunca encolhe abaixo do próprio
    // conteúdo sem ele, e aí a lista de mensagens estica em vez de rolar,
    // empurrando cabeçalho e compositor pra fora da tela.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-card px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar className="size-9 shrink-0">
            <AvatarFallback className={cn("text-xs font-medium", avatarColor(conversation.customer.id))}>
              {initials(conversation.customer.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{conversation.customer.name}</p>
            <p className="truncate text-xs text-muted-foreground">{conversation.customer.phone}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Buscar nesta conversa"
            title="Buscar nesta conversa"
            onClick={() => setSearchOpen((open) => !open)}
          >
            <Search className="size-4" />
          </Button>
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
        {hasOlder ? (
          <div className="flex justify-center pb-2">
            <Button size="sm" variant="secondary" onClick={() => void onLoadOlder()}>
              Carregar mensagens anteriores
            </Button>
          </div>
        ) : null}
        {conversation.messages.map((message: ConversationMessage, index) => {
          const previous = conversation.messages[index - 1];
          const startsNewDay = !previous || !sameDay(previous.createdAt, message.createdAt);
          return (
            <div key={message.id} className="contents">
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
                  if (event.target === event.currentTarget) onReply(message);
                }}
                title={message.senderType === "SYSTEM" ? undefined : "Clique duas vezes para responder"}
                className={cn(
                  // cursor-pointer só na faixa vazia: o balão volta pro
                  // cursor de texto (abaixo, no próprio balão) pra não
                  // atrapalhar quem quer selecionar e copiar.
                  "flex w-full min-w-0 cursor-pointer",
                  message.senderType === "CUSTOMER" ? "justify-start" : "justify-end",
                  message.senderType === "SYSTEM" && "cursor-default justify-center",
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
        />
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
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
            composicaoTravada
              ? "Conversa encerrada — reabra para responder"
              : isResolved
                ? "Responder reabre o atendimento"
                : "Escreva uma mensagem..."
          }
          disabled={composicaoTravada || sending}
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
      )}
    </div>
  );
}
