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
import { AvatarDoCliente } from "@/components/avatar-do-cliente";
import { EmptyState } from "@/components/empty-state";
import { PRIORITY_META } from "@/lib/priority";
import { COR_DA_SITUACAO, situacaoDoAtendimento } from "@/lib/situacao";
import { cn } from "@/lib/utils";
import type { ConversationDetail } from "@/lib/types";
import { CustomerNotes } from "./customer-notes";
import { TasksSection } from "./tasks-section";

/** "há 12 min", "há 3 h", "há 2 dias" — o tempo de espera de relance. */
function ha(iso: string): string {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

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

/** Hoje mostra a hora; outro dia, a data — como na lista de conversas. */
function quando(iso: string | null | undefined) {
  if (!iso) return "—";
  const data = new Date(iso);
  const hoje = new Date();
  if (data.toDateString() === hoje.toDateString()) {
    return `Hoje, ${data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
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
  const situacao = situacaoDoAtendimento(conversation);
  const encerrada = situacao.tom === "fim";

  return (
    // `pb-24`: o botão flutuante do assistente fica no canto de baixo e
    // cobria a última linha da ficha ("O que a IA lembra").
    <div className="flex flex-col gap-5 p-4 pb-24">
      {/* Cabeçalho com a cara do contato. Antes o painel abria direto numa
          lista de "rótulo: valor", que é ficha cadastral, não pessoa. */}
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <AvatarDoCliente
          cliente={customer}
          className="size-16"
          tamanho={64}
          textoClassName="text-lg"
          conferir
          ampliavel
        />
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
          <Badge variant="secondary" className="gap-1.5 font-normal">
            <span className={cn("size-1.5 rounded-full", COR_DA_SITUACAO[situacao.tom])} aria-hidden />
            {situacao.rotulo}
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
          {/* Uma resposta pra "quem está cuidando disto?", no lugar de
              "IA: Com atendente" + "Responsável" em linhas separadas, que
              juntas não diziam nada de uma vez (ver situacaoDoAtendimento). */}
          <InfoRow
            label="Situação"
            value={
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn("size-2 shrink-0 rounded-full", COR_DA_SITUACAO[situacao.tom])}
                  aria-hidden
                />
                {situacao.rotulo}
              </span>
            }
          />
          {situacao.detalhe ? (
            <p className="text-right text-xs text-muted-foreground text-pretty">
              {situacao.detalhe}
            </p>
          ) : null}
          {/* De quem é a vez — e há quanto tempo o cliente espera, quando é
              da equipe. É o número que decide qual conversa atender antes. */}
          {encerrada ? null : (
            <InfoRow
              label="Quem responde"
              value={
                conversation.status === "WAITING_CUSTOMER" ? (
                  "O cliente"
                ) : conversation.waitingSince ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    A equipe · {ha(conversation.waitingSince)}
                  </span>
                ) : (
                  "A equipe"
                )
              }
            />
          )}
          {conversation.queue ? <InfoRow label="Setor" value={conversation.queue.name} /> : null}
          <InfoRow label="Última mensagem" value={quando(conversation.lastMessageAt)} />
        </div>
      </Section>

      {/* Fora de <Section>: as anotações têm cabeçalho próprio, que serve de
          botão pra abrir e fechar. Fechado é uma linha só — a ficha não
          precisa carregar isso à mostra o tempo todo. */}
      <div>
        <CustomerNotes key={customer.id} customerId={customer.id} />
      </div>

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
