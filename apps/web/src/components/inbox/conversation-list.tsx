"use client";

import { MessageSquareDashed, Timer } from "lucide-react";
import { useEffect, useRef } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { avatarColor, initials } from "@/lib/avatar";
import { PRIORITY_META } from "@/lib/priority";
import { cn } from "@/lib/utils";
import type { ConversationStatus, ConversationSummary } from "@/lib/types";

/** Prévia de mídia na lista, no espírito do "📷 Foto" do WhatsApp. */
const MEDIA_PREVIEW: Record<string, string> = {
  IMAGE: "Imagem",
  AUDIO: "Áudio",
  VIDEO: "Vídeo",
  DOCUMENT: "Documento",
  LOCATION: "Localização",
  OTHER: "Anexo",
};

const STATUS_LABEL: Record<ConversationStatus, string> = {
  OPEN: "Aberta",
  WAITING_CUSTOMER: "Aguard. cliente",
  WAITING_AGENT: "Aguard. atendente",
  RESOLVED: "Resolvida",
  CLOSED: "Fechada",
};

/** Relativo e curto, como numa lista de conversas de mensageiro. */
function timeLabel(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);

  if (diffDays === 0) return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) return date.toLocaleDateString("pt-BR", { weekday: "short" });
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/**
 * Há quanto tempo este cliente espera resposta.
 *
 * Só aparece quando passa de uma hora: abaixo disso a informação é ruído —
 * atendimento normal responde em minutos, e uma etiqueta em toda linha
 * deixaria de significar "olha aqui" pra virar parte do desenho.
 *
 * O tom sobe com a espera porque é assim que a pessoa varre a lista: nada
 * até uma hora, âmbar quando começa a incomodar, vermelho quando já é
 * problema.
 */
function esperaVisivel(waitingSince: string | null | undefined) {
  if (!waitingSince) return null;

  const minutos = Math.floor((Date.now() - new Date(waitingSince).getTime()) / 60000);
  if (minutos < 60) return null;

  const horas = Math.floor(minutos / 60);
  const rotulo = horas < 24 ? `${horas}h` : `${Math.floor(horas / 24)}d`;

  return {
    rotulo,
    // Quatro horas é o corte: dentro de um expediente ainda é recuperável,
    // acima disso o cliente já passou a manhã inteira esperando.
    grave: horas >= 4,
  };
}

export function ConversationList({
  conversations,
  selectedId,
  liveUnread,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
}: {
  conversations: ConversationSummary[];
  selectedId: string | null;
  /** Não lidas que chegaram via socket depois do último carregamento. */
  liveUnread?: Record<string, number>;
  loading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onSelect: (id: string) => void;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Rolagem infinita: um observador na última linha dispara a próxima
  // página antes de a pessoa chegar no fim, então a lista parece não ter
  // fim em vez de dar um solavanco de carregamento.
  useEffect(() => {
    const element = sentinelRef.current;
    if (!element || !hasMore || !onLoadMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onLoadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, conversations.length]);

  if (loading) {
    return (
      <div className="flex flex-col gap-1 overflow-y-auto p-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-start gap-3 py-1.5">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <EmptyState
          icon={MessageSquareDashed}
          title="Nenhuma conversa aqui"
          description="Ajuste os filtros acima ou espere alguém mandar mensagem."
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col py-1.5">
      {conversations.map((conversation) => {
        // O contador do banco é a verdade; o do socket cobre o intervalo
        // entre a última busca e agora, sem precisar refazer a lista.
        const unread = Math.max(conversation.unreadCount, liveUnread?.[conversation.id] ?? 0);
        const selected = selectedId === conversation.id;
        const priority = PRIORITY_META[conversation.priority];
        const showPriority = conversation.priority === "URGENT" || conversation.priority === "HIGH";
        const last = conversation.lastMessage;
        const preview = last
          ? `${last.senderType === "CUSTOMER" ? "" : "Você: "}${
              last.messageType === "TEXT" ? last.content : MEDIA_PREVIEW[last.messageType] ?? "Anexo"
            }`
          : "Sem mensagens ainda";

        return (
          <button
            key={conversation.id}
            type="button"
            onClick={() => onSelect(conversation.id)}
            // Sem barra colorida na lateral e sem fundo tingido: a conversa
            // selecionada muda de superfície, e só. Quem chama atenção na
            // linha é o contador de não lidas, como em qualquer mensageiro.
            // Sem divisória nenhuma entre as conversas: o espaçamento já
            // separa. O que responde ao mouse é a superfície inteira, com
            // canto arredondado — o mesmo gesto do WhatsApp.
            className={cn(
              "mx-1.5 flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors duration-150",
              selected ? "bg-accent" : "hover:bg-accent/60",
            )}
            // A ordem muda quando chega mensagem. Sem animação a lista
            // "pisca" e a pessoa perde de vista onde estava.
            style={{ viewTransitionName: `conversa-${conversation.id}` }}
          >
            <Avatar className="size-11 shrink-0">
              <AvatarFallback className={cn("text-xs font-medium", avatarColor(conversation.customer.id))}>
                {initials(conversation.customer.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className={cn("truncate text-[15px]", unread > 0 ? "font-semibold" : "font-medium")}>
                  {conversation.customer.name}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={cn(
                      "text-[11px]",
                      unread > 0 ? "font-medium text-primary" : "text-muted-foreground",
                    )}
                  >
                    {timeLabel(conversation.lastMessageAt)}
                  </span>
                  {unread > 0 ? (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  ) : null}
                  {(() => {
                    const espera = esperaVisivel(conversation.waitingSince);
                    if (!espera) return null;
                    return (
                      <span
                        title={`Sem resposta há ${espera.rotulo}`}
                        className={cn(
                          "flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                          espera.grave
                            ? "bg-destructive/15 text-destructive"
                            : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                        )}
                      >
                        <Timer className="size-3" />
                        {espera.rotulo}
                      </span>
                    );
                  })()}
                </div>
              </div>
              {/* Uma linha só embaixo do nome: a prévia manda, e as
                  etiquetas aparecem espremidas à direita apenas quando
                  dizem algo. "Aberta" e "sem responsável" são o normal —
                  repetir isso em toda linha vira ruído, não informação. */}
              <div className="mt-0.5 flex items-center gap-1.5">
                <p
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13px]",
                    unread > 0 ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {preview}
                </p>
                {showPriority ? (
                  <span
                    title={`Prioridade ${priority.label.toLowerCase()}`}
                    className={cn("size-2 shrink-0 rounded-full", priority.dot)}
                    aria-label={`Prioridade ${priority.label.toLowerCase()}`}
                  />
                ) : null}
                {conversation.status !== "OPEN" ? (
                  <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
                    {STATUS_LABEL[conversation.status]}
                  </Badge>
                ) : null}
                {conversation.assignedUser ? (
                  <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                    {conversation.assignedUser.name.split(" ")[0]}
                  </Badge>
                ) : null}
              </div>
            </div>
          </button>
        );
      })}
      </div>

      {hasMore ? (
        <div ref={sentinelRef} className="flex justify-center py-3">
          <span className="text-xs text-muted-foreground">
            {loadingMore ? "Carregando..." : " "}
          </span>
        </div>
      ) : null}
    </div>
  );
}
