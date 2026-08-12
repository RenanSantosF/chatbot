"use client";

import {
  AtSign,
  Bot,
  CalendarClock,
  Flag,
  Image as ImageIcon,
  MessageSquare,
  Phone,
  UserRound,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/empty-state";
import { avatarColor, initials } from "@/lib/avatar";
import { PRIORITY_META } from "@/lib/priority";
import { cn } from "@/lib/utils";
import type { AiMode, ConversationDetail, ConversationStatus } from "@/lib/types";
import { TasksSection } from "./tasks-section";

const STATUS_LABEL: Record<ConversationStatus, string> = {
  OPEN: "Aberta",
  WAITING_CUSTOMER: "Aguardando cliente",
  WAITING_AGENT: "Aguardando atendente",
  RESOLVED: "Resolvida",
  CLOSED: "Fechada",
};

const AI_MODE_LABEL: Record<AiMode, string> = {
  AI_ACTIVE: "IA respondendo",
  HUMAN_ACTIVE: "Com atendente",
  AI_ASSIST: "IA sugerindo",
  PAUSED: "Pausada",
};

/** Seção com título discreto — o mesmo ritmo em todo o painel. */
function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof UserRound;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{value}</span>
    </div>
  );
}

function firstAndLast(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function CustomerPanel({ conversation }: { conversation: ConversationDetail | null }) {
  if (!conversation) {
    return (
      <div className="p-4">
        <EmptyState
          icon={UserRound}
          title="Sem conversa aberta"
          description="Os dados do cliente aparecem aqui quando você abre uma conversa."
        />
      </div>
    );
  }

  const customer = conversation.customer;
  const priority = PRIORITY_META[conversation.priority];
  const messages = conversation.messages;
  const fromCustomer = messages.filter((m) => m.senderType === "CUSTOMER").length;
  const media = messages.filter((m) => m.messageType === "IMAGE" || m.messageType === "VIDEO");
  const collected = conversation.collectedData ?? {};
  const remembered = customer.metadata ?? {};

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Cabeçalho com a cara do contato. Antes o painel abria direto numa
          lista de "rótulo: valor", que é ficha cadastral, não pessoa. */}
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <Avatar className="size-16">
          <AvatarFallback className={cn("text-lg font-medium", avatarColor(customer.id))}>
            {initials(customer.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate font-semibold">{customer.name}</p>
          <a
            href={`tel:${customer.phone}`}
            className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <Phone className="size-3" />
            {customer.phone}
          </a>
        </div>
        <div className="flex flex-wrap justify-center gap-1.5">
          <Badge variant="secondary" className="font-normal">
            {STATUS_LABEL[conversation.status]}
          </Badge>
          <Badge variant="outline" className="gap-1 font-normal">
            <span className={cn("size-1.5 rounded-full", priority.dot)} aria-hidden />
            {priority.label}
          </Badge>
        </div>
      </div>

      {/* Três números que respondem "como está esse atendimento?" sem
          precisar rolar a conversa inteira. */}
      <div className="grid grid-cols-3 gap-1.5">
        {[
          { icon: MessageSquare, value: messages.length, label: "mensagens" },
          { icon: Users, value: fromCustomer, label: "do cliente" },
          { icon: ImageIcon, value: media.length, label: "mídias" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="flex flex-col items-center gap-0.5 rounded-lg bg-muted/60 py-2.5"
          >
            <stat.icon className="size-3.5 text-muted-foreground" />
            <span className="text-base leading-none font-semibold tabular-nums">{stat.value}</span>
            <span className="text-[10px] text-muted-foreground">{stat.label}</span>
          </div>
        ))}
      </div>

      <Section title="Atendimento" icon={Bot}>
        <div className="flex flex-col gap-1.5">
          <InfoRow label="IA" value={AI_MODE_LABEL[conversation.aiMode]} />
          <InfoRow label="Responsável" value={conversation.assignedUser?.name ?? "Ninguém"} />
          {conversation.queue ? <InfoRow label="Fila" value={conversation.queue.name} /> : null}
          <InfoRow
            label="Última mensagem"
            value={firstAndLast(conversation.lastMessageAt)}
          />
        </div>
      </Section>

      {customer.email ? (
        <Section title="Contato" icon={AtSign}>
          <InfoRow label="E-mail" value={customer.email} />
        </Section>
      ) : null}

      {conversation.escalationReason || conversation.escalationSummary ? (
        <Section title="Por que veio pra equipe" icon={Flag}>
          {conversation.escalationReason ? (
            <p className="text-sm">{conversation.escalationReason}</p>
          ) : null}
          {conversation.escalationSummary ? (
            <p className="rounded-md bg-muted/60 p-2.5 text-xs leading-relaxed text-muted-foreground">
              {conversation.escalationSummary}
            </p>
          ) : null}
        </Section>
      ) : null}

      {Object.keys(collected).length > 0 ? (
        <Section title="Dados coletados" icon={CalendarClock}>
          <div className="flex flex-col gap-1.5">
            {Object.entries(collected).map(([key, value]) => (
              <InfoRow key={key} label={key} value={value} />
            ))}
          </div>
        </Section>
      ) : null}

      {Object.keys(remembered).length > 0 ? (
        <Section title="O que a IA lembra" icon={Bot}>
          <div className="flex flex-col gap-1.5">
            {Object.entries(remembered).map(([key, value]) => (
              <InfoRow key={key} label={key} value={String(value)} />
            ))}
          </div>
        </Section>
      ) : null}

      <TasksSection key={conversation.id} conversationId={conversation.id} />
    </div>
  );
}
