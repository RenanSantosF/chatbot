"use client";

import { ListFilter, Search } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/priority";
import { cn } from "@/lib/utils";
import type { ConversationPriority, ConversationStatus } from "@/lib/types";

export interface InboxFilters {
  status: ConversationStatus | "ALL";
  priority: ConversationPriority | "ALL";
  scope: "ALL" | "MINE" | "UNREAD" | "UNASSIGNED";
  search: string;
}

export const DEFAULT_FILTERS: InboxFilters = {
  status: "ALL",
  priority: "ALL",
  scope: "ALL",
  search: "",
};

/** Contagens vindas do servidor — refletem a base inteira, não a página. */
export interface FilterCounts {
  total: number;
  unread: number;
  mine: number;
  unassigned: number;
  status: Partial<Record<ConversationStatus, number>>;
  priority: Partial<Record<ConversationPriority, number>>;
}

const STATUS_ORDER: ConversationStatus[] = [
  "OPEN",
  "WAITING_AGENT",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
];

const STATUS_LABEL: Record<ConversationStatus, string> = {
  OPEN: "Abertas",
  WAITING_AGENT: "Aguard. atendente",
  WAITING_CUSTOMER: "Aguard. cliente",
  RESOLVED: "Resolvidas",
  CLOSED: "Fechadas",
};

interface ChipOption {
  value: string;
  label: string;
  count?: number;
  dot?: string;
}

/**
 * Fila de pastilhas no lugar de um seletor. É o mesmo gesto do WhatsApp
 * Web ("Tudo · Não lidas · Favoritas"): o valor ativo fica à vista e trocar
 * custa um clique, não dois. Rola na horizontal porque a coluna é estreita
 * e quebrar linha faria a lista pular de altura conforme o filtro.
 */
function ChipRow({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: ChipOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs whitespace-nowrap transition-colors duration-150",
              active
                ? "bg-primary/15 font-medium text-primary"
                : "bg-muted/70 text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {option.dot ? (
              <span className={cn("size-1.5 rounded-full", option.dot)} aria-hidden />
            ) : null}
            {option.label}
            {option.count === undefined ? null : (
              <span className="tabular-nums opacity-70">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function InboxFilterBar({
  value,
  counts,
  onChange,
  action,
}: {
  value: InboxFilters;
  counts: FilterCounts;
  onChange: (filters: InboxFilters) => void;
  /** Botão de ação que fica à direita da busca (ex.: simular cliente). */
  action?: React.ReactNode;
}) {
  // Situação e prioridade são filtros de exceção: quem atende passa o dia
  // em "tudo". Ficam atrás do funil pra não ocupar altura o tempo todo,
  // mas já abrem se houver algum aplicado (filtro escondido é armadilha).
  const [showMore, setShowMore] = useState(
    value.status !== "ALL" || value.priority !== "ALL",
  );

  const set = <K extends keyof InboxFilters>(key: K, next: InboxFilters[K]) =>
    onChange({ ...value, [key]: next });

  const refining = value.status !== "ALL" || value.priority !== "ALL";

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value.search}
            onChange={(event) => set("search", event.target.value)}
            placeholder="Buscar nome ou telefone"
            className="h-9 rounded-full border-transparent bg-muted/70 pl-7 text-xs shadow-none"
          />
        </div>
        <button
          type="button"
          aria-label="Mais filtros"
          aria-pressed={showMore}
          title="Situação e prioridade"
          onClick={() => setShowMore((open) => !open)}
          className={cn(
            "relative flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
            showMore ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent",
          )}
        >
          <ListFilter className="size-4" />
          {refining ? (
            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />
          ) : null}
        </button>
        {action}
      </div>

      <ChipRow
        name="Mostrar quais conversas"
        value={value.scope}
        onChange={(next) => set("scope", next as InboxFilters["scope"])}
        options={[
          { value: "ALL", label: "Tudo", count: counts.total },
          { value: "UNREAD", label: "Não lidas", count: counts.unread },
          { value: "MINE", label: "Minhas", count: counts.mine },
          { value: "UNASSIGNED", label: "Sem dono", count: counts.unassigned },
        ]}
      />

      {showMore ? (
        <div className="flex flex-col gap-1.5 duration-200 animate-in fade-in slide-in-from-top-1">
          <ChipRow
            name="Filtrar por situação"
            value={value.status}
            onChange={(next) => set("status", next as InboxFilters["status"])}
            options={[
              { value: "ALL", label: "Todas" },
              ...STATUS_ORDER.map((status) => ({
                value: status,
                label: STATUS_LABEL[status],
                count: counts.status[status] ?? 0,
              })),
            ]}
          />
          <ChipRow
            name="Filtrar por prioridade"
            value={value.priority}
            onChange={(next) => set("priority", next as InboxFilters["priority"])}
            options={[
              { value: "ALL", label: "Qualquer" },
              ...PRIORITY_ORDER.map((priority) => ({
                value: priority,
                label: PRIORITY_META[priority].label,
                count: counts.priority[priority] ?? 0,
                dot: PRIORITY_META[priority].dot,
              })),
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}
