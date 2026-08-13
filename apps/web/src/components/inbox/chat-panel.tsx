"use client";

import { ChevronDown, ChevronUp, MessagesSquare, Paperclip, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
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
}) {
  const { user } = useSession();
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
          disabled={isResolved || sending}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>
        <EmojiPicker
          disabled={isResolved || sending}
          onPick={(emoji) => setDraft((atual) => atual + emoji)}
        />
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={handlePaste}
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
          placeholder={isResolved ? "Conversa resolvida" : "Escreva uma mensagem..."}
          disabled={isResolved || sending}
          className="rounded-md"
        />
        {/* No canto onde estava o botão de enviar. O gravador se expande
            sobre o compositor enquanto grava, então precisa ser o último
            item da linha pra não empurrar o campo de texto. */}
        <VoiceRecorder disabled={isResolved || sending} onRecorded={onSendFile} />
      </form>
      )}
    </div>
  );
}
