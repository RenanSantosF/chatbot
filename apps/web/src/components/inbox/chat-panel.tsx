"use client";

import {
  ChevronDown,
  ChevronUp,
  MessagesSquare,
  Paperclip,
  Search,
  SendHorizonal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/empty-state";
import { avatarColor, initials } from "@/lib/avatar";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/priority";
import { cn } from "@/lib/utils";
import { MessageBubble } from "./message-bubble";
import { AttachmentComposer } from "./attachment-composer";
import { ForwardDialog } from "./forward-dialog";
import { VoiceRecorder } from "./voice-recorder";
import type { ConversationDetail, ConversationMessage, ConversationPriority } from "@/lib/types";

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
      <span className="rounded-full bg-background/90 px-3 py-1 text-xs font-medium text-muted-foreground capitalize shadow-xs ring-1 ring-foreground/5">
        {label}
      </span>
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
  onAssign,
  onResolve,
  onReopen,
  onReactivateAi,
  onChangePriority,
  onSendFile,
  replyTo,
  hasOlder,
  onLoadOlder,
  onReply,
  onCancelReply,
  onReact,
}: {
  conversation: ConversationDetail | null;
  /** Há conversa escolhida, mas os dados ainda estão vindo. */
  loading?: boolean;
  sending: boolean;
  onSend: (content: string) => Promise<void>;
  onAssign: () => Promise<void>;
  onResolve: () => Promise<void>;
  onReopen: () => Promise<void>;
  onReactivateAi: () => Promise<void>;
  onChangePriority: (priority: ConversationPriority) => Promise<void>;
  onSendFile: (file: File, caption?: string) => Promise<void>;
  replyTo: ConversationMessage | null;
  hasOlder: boolean;
  onLoadOlder: () => Promise<void>;
  onReply: (message: ConversationMessage) => void;
  onCancelReply: () => void;
  onReact: (messageId: string, emoji: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [needle, setNeedle] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [forwarding, setForwarding] = useState<ConversationMessage | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const firstPaintRef = useRef(true);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    if (!currentMatchId) return;
    document
      .querySelector(`[data-message-id="${currentMatchId}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentMatchId]);

  useEffect(() => {
    // Não puxa pro fim enquanto a pessoa está navegando pelos resultados.
    if (currentMatchId) return;
    // Mexe no scrollTop do container em vez de scrollIntoView: este último
    // respeita `scroll-behavior` herdado e continuava animando na abertura,
    // que era exatamente o que incomodava. Aqui a primeira pintura salta
    // seco pro fim e só mensagem nova desliza.
    const area = scrollAreaRef.current;
    if (!area) return;
    const primeira = firstPaintRef.current;
    firstPaintRef.current = false;

    const irAoFim = () => {
      if (primeira) area.scrollTop = area.scrollHeight;
      else area.scrollTo({ top: area.scrollHeight, behavior: "smooth" });
    };

    irAoFim();
    // De novo no quadro seguinte: imagem e anexo só ganham altura depois
    // de pintar, e sem isso a conversa abria parando pouco antes do fim.
    const quadro = requestAnimationFrame(irAoFim);
    return () => cancelAnimationFrame(quadro);
  }, [conversation?.id, conversation?.messages.length, currentMatchId]);

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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
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
              <Button size="sm" variant="outline" onClick={onAssign}>
                Assumir
              </Button>
              <Button size="sm" variant="outline" onClick={onResolve}>
                Resolver
              </Button>
            </>
          )}
          {isResolved && (
            <Button size="sm" variant="outline" onClick={onReopen}>
              Reabrir
            </Button>
          )}
          {!isResolved && conversation.aiMode !== "AI_ACTIVE" && (
            <Button size="sm" variant="ghost" onClick={onReactivateAi}>
              Reativar IA
            </Button>
          )}
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
          if (!isResolved) setDragging(true);
        }}
        onDragLeave={(event) => {
          // Só apaga o realce quando o ponteiro sai de verdade da área —
          // sem isso ele pisca ao passar por cima de cada balão.
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={isResolved ? undefined : handleDrop}
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
                className={cn(
                  "flex w-full min-w-0",
                  message.senderType === "CUSTOMER" ? "justify-start" : "justify-end",
                  message.senderType === "SYSTEM" && "justify-center",
                )}
              >
              <MessageBubble
                message={message}
                highlight={needle.trim()}
                isCurrentMatch={message.id === currentMatchId}
                onReply={onReply}
                onReact={onReact}
                onForward={setForwarding}
              />
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <ForwardDialog
        message={forwarding}
        fromConversationId={conversation.id}
        onClose={() => setForwarding(null)}
      />

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
         superfície já marca a separação, que era o pedido. */
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
          disabled={isResolved || sending}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>
        <VoiceRecorder disabled={isResolved || sending} onRecorded={onSendFile} />
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={handlePaste}
          placeholder={isResolved ? "Conversa resolvida" : "Escreva uma mensagem..."}
          disabled={isResolved || sending}
          className="rounded-md"
        />
        <Button
          type="submit"
          size="icon-lg"
          className="shrink-0"
          aria-label="Enviar mensagem"
          disabled={isResolved || sending || !draft.trim()}
        >
          {sending ? <Spinner /> : <SendHorizonal className="size-4" />}
        </Button>
      </form>
      )}
    </div>
  );
}
