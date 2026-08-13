import { Check, CheckCheck, Forward, Reply, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageAttachment } from "./message-attachment";
import type { ConversationMessage, MessageStatus } from "@/lib/types";

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Tiques no padrão do WhatsApp: um tique = saiu daqui, dois tiques = chegou
 * no aparelho, dois tiques azuis = o cliente leu. Só aparece em mensagem que
 * a empresa mandou — mensagem de cliente não tem status de entrega nosso.
 */
function DeliveryTicks({ status }: { status: MessageStatus }) {
  if (status === "FAILED") {
    return (
      <span title="Falha ao entregar" className="text-destructive">
        <TriangleAlert className="size-3.5" />
      </span>
    );
  }

  if (status === "PENDING") {
    return (
      <span title="Enviando" className="opacity-70">
        <Check className="size-3.5 opacity-50" />
      </span>
    );
  }

  if (status === "SENT") {
    return (
      <span title="Enviada" className="opacity-70">
        <Check className="size-3.5" />
      </span>
    );
  }

  return (
    <span
      title={status === "READ" ? "Lida" : "Entregue"}
      className={cn(status === "READ" ? "text-sky-500" : "opacity-60")}
    >
      <CheckCheck className="size-3.5" />
    </span>
  );
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "🙏"];

/**
 * Pinta os trechos que casam com a busca. Divide pelo termo em vez de usar
 * innerHTML: o conteúdo vem do cliente e não pode virar marcação.
 */
function Highlighted({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <mark key={index} className="rounded-xs bg-amber-300/70 text-inherit dark:bg-amber-400/40">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

export function MessageBubble({
  message,
  highlight = "",
  isCurrentMatch = false,
  onReply,
  onReact,
  onForward,
}: {
  message: ConversationMessage;
  /** Termo buscado na conversa, pra pintar dentro do balão. */
  highlight?: string;
  /** Resultado em foco na navegação da busca. */
  isCurrentMatch?: boolean;
  onReply?: (message: ConversationMessage) => void;
  onReact?: (messageId: string, emoji: string) => Promise<void>;
  onForward?: (message: ConversationMessage) => void;
}) {
  if (message.senderType === "SYSTEM") {
    return (
      <p className="self-center rounded-full bg-muted/80 px-3 py-1 text-center text-xs text-muted-foreground shadow-xs">
        {message.content}
      </p>
    );
  }

  const fromCustomer = message.senderType === "CUSTOMER";
  const reactions = Object.entries(message.reactions ?? {}).filter(
    ([, who]) => Array.isArray(who) && who.length > 0,
  );

  return (
    <div
      data-message-id={message.id}
      className={cn(
        "group/msg relative flex max-w-[75%] flex-col",
        fromCustomer ? "self-start" : "self-end",
        isCurrentMatch && "rounded-2xl ring-2 ring-amber-400/70",
      )}
    >
      {/* Faixa de duplo clique AO LADO do balão, nunca sobre ele: dentro,
          o gesto competia com selecionar e copiar o texto da mensagem. */}
      {onReply ? (
        <span
          onDoubleClick={() => onReply(message)}
          title="Clique duas vezes para responder"
          aria-hidden
          // Cobre TODA a faixa vazia ao lado da mensagem, até a borda do
          // chat — não só uns pixels colados no balão. `w-screen` com
          // overflow escondido no pai resolve sem precisar medir largura.
          className={cn(
            "absolute inset-y-0 w-screen cursor-cell select-none",
            fromCustomer ? "left-full" : "right-full",
          )}
        />
      ) : null}
      {onReply || onReact || onForward ? (
        <div
          className={cn(
            // Fica inteiro acima do balão (bottom-full), não por cima dele.
            // Sem borda: a sombra já destaca, e o traço em volta de um menu
            // pequeno vira moldura. Emoji em 20px porque abaixo disso o
            // navegador rasteriza a fonte de emoji e ela sai serrilhada.
            "absolute bottom-full z-10 mb-1.5 flex items-center gap-1 rounded-full bg-popover px-1.5 py-1 opacity-0 shadow-[0_2px_12px_oklch(0_0_0/18%)] transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100",
            fromCustomer ? "left-2" : "right-2",
          )}
        >
          {onReact
            ? QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  title={`Reagir com ${emoji}`}
                  onClick={() => void onReact(message.id, emoji)}
                  className="rounded-full px-1 text-[20px] leading-none transition-transform hover:scale-125"
                >
                  {emoji}
                </button>
              ))
            : null}
          {onReply ? (
            <button
              type="button"
              title="Responder"
              aria-label="Responder esta mensagem"
              onClick={() => onReply(message)}
              className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Reply className="size-4.5" />
            </button>
          ) : null}
          {onForward ? (
            <button
              type="button"
              title="Encaminhar"
              aria-label="Encaminhar esta mensagem"
              onClick={() => onForward(message)}
              className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Forward className="size-4.5" />
            </button>
          ) : null}
        </div>
      ) : null}

    <div
      className={cn(
        // Sombra rasa e anel finíssimo: o balão precisa se destacar do
        // papel de parede sem parecer um cartão empilhado. O verde de saída
        // no escuro é dessaturado de propósito — o verde cheio do app
        // brigava com o cinza da interface.
        "flex flex-col gap-0.5 rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed shadow-[0_1px_1px_oklch(0_0_0/6%)] duration-200 ease-out animate-in fade-in",
        fromCustomer
          ? "rounded-bl-sm bg-card text-card-foreground slide-in-from-left-2"
          : "rounded-br-sm bg-bubble-out text-bubble-out-foreground slide-in-from-right-2",
      )}
    >
      {message.replyTo ? (
        <div
          className={cn(
            "mb-1 rounded-md border-l-2 px-2 py-1 text-xs",
            fromCustomer
              ? "border-primary/60 bg-black/5 dark:bg-white/10"
              : "border-primary-foreground/60 bg-black/10",
          )}
        >
          <p className="font-medium opacity-80">
            {message.replyTo.senderType === "CUSTOMER" ? "Cliente" : "Você"}
          </p>
          <p className="line-clamp-2 opacity-70">{message.replyTo.content || "Anexo"}</p>
        </div>
      ) : null}

      {message.messageType !== "TEXT" ? <MessageAttachment message={message} /> : null}
      {message.content ? (
        <span className="whitespace-pre-wrap break-words">
          <Highlighted text={message.content} term={highlight} />
        </span>
      ) : null}
      <span
        className={cn(
          "flex items-center justify-end gap-1 text-[11px] leading-none",
          fromCustomer ? "text-muted-foreground" : "text-bubble-out-foreground/70",
        )}
      >
        {message.senderType === "AI" ? <span className="font-medium">IA</span> : null}
        <span>{timeLabel(message.createdAt)}</span>
        {fromCustomer ? null : <DeliveryTicks status={message.status} />}
      </span>
    </div>

      {reactions.length > 0 ? (
        <div className={cn("-mt-1.5 flex gap-1", fromCustomer ? "self-start pl-2" : "self-end pr-2")}>
          {reactions.map(([emoji, who]) => (
            <span
              key={emoji}
              className="flex items-center gap-0.5 rounded-full border bg-popover px-1.5 py-0.5 text-[11px] shadow-xs"
            >
              {emoji}
              {who.length > 1 ? <span className="text-muted-foreground">{who.length}</span> : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
