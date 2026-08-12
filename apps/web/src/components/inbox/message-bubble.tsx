import { cn } from "@/lib/utils";
import type { ConversationMessage } from "@/lib/types";

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function MessageBubble({ message }: { message: ConversationMessage }) {
  if (message.senderType === "SYSTEM") {
    return (
      <p className="self-center rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
        {message.content}
      </p>
    );
  }

  const fromCustomer = message.senderType === "CUSTOMER";

  return (
    <div
      className={cn(
        "flex max-w-[70%] flex-col gap-1 rounded-2xl px-3.5 py-2 text-sm leading-relaxed duration-200 ease-out animate-in fade-in",
        fromCustomer
          ? "self-start rounded-bl-sm border bg-card slide-in-from-left-2"
          : "self-end rounded-br-sm bg-primary text-primary-foreground slide-in-from-right-2",
      )}
    >
      <span className="whitespace-pre-wrap">{message.content}</span>
      <span
        className={cn(
          "self-end text-[10px] opacity-70",
          fromCustomer ? "text-muted-foreground" : "text-primary-foreground",
        )}
      >
        {message.senderType === "AI" ? "IA · " : null}
        {timeLabel(message.createdAt)}
      </span>
    </div>
  );
}
