import { Check, CheckCheck, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
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
      className={cn(status === "READ" ? "text-sky-300" : "opacity-70")}
    >
      <CheckCheck className="size-3.5" />
    </span>
  );
}

export function MessageBubble({ message }: { message: ConversationMessage }) {
  if (message.senderType === "SYSTEM") {
    return (
      <p className="self-center rounded-full bg-muted/80 px-3 py-1 text-center text-xs text-muted-foreground shadow-xs">
        {message.content}
      </p>
    );
  }

  const fromCustomer = message.senderType === "CUSTOMER";

  return (
    <div
      className={cn(
        "flex max-w-[75%] flex-col gap-0.5 rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm duration-200 ease-out animate-in fade-in",
        fromCustomer
          ? "self-start rounded-bl-sm bg-card text-card-foreground ring-1 ring-foreground/5 slide-in-from-left-2"
          : "self-end rounded-br-sm bg-primary text-primary-foreground slide-in-from-right-2",
      )}
    >
      <span className="whitespace-pre-wrap break-words">{message.content}</span>
      <span
        className={cn(
          "flex items-center justify-end gap-1 text-[10px] leading-none",
          fromCustomer ? "text-muted-foreground" : "text-primary-foreground/80",
        )}
      >
        {message.senderType === "AI" ? <span className="font-medium">IA</span> : null}
        <span>{timeLabel(message.createdAt)}</span>
        {fromCustomer ? null : <DeliveryTicks status={message.status} />}
      </span>
    </div>
  );
}
