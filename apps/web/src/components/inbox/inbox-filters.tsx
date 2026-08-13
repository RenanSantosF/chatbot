"use client";

import { ListFilter, Search, X } from "lucide-react";
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
/**
 * Segmentos, não pastilhas soltas. A versão anterior era uma fila de
 * pílulas do mesmo tamanho e peso: dava pra ver que existiam filtros, mas
 * não qual estava valendo, e a contagem competia com o rótulo. Aqui o
 * fundo do trilho agrupa as opções, o segmento ativo ganha superfície
 * elevada, e a contagem vira uma bolinha à direita do rótulo.
 */
function SegmentRow({
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
      className="flex gap-0.5 overflow-x-auto rounded-lg bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
              "flex shrink-0 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] whitespace-nowrap transition-all duration-150",
              active
                ? "bg-card font-semibold text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.dot ? (
              <span className={cn("size-2 rounded-full", option.dot)} aria-hidden />
            ) : null}
            {option.label}
            {option.count === undefined || option.count === 0 ? null : (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[11px] leading-none tabular-nums",
                  active ? "bg-primary text-primary-foreground" : "bg-foreground/10",
                )}
              >
                {option.count}
              </span>
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
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value.search}
            onChange={(event) => set("search", event.target.value)}
            placeholder="Buscar nome ou telefone"
            className="h-10 rounded-lg border-transparent bg-muted pl-8 text-[13px] shadow-none"
          />
        </div>
        <button
          type="button"
          aria-label="Mais filtros"
          aria-pressed={showMore}
          title="Situação e prioridade"
          onClick={() => setShowMore((open) => !open)}
          className={cn(
            "relative flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors",
            showMore ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent",
          )}
        >
          <ListFilter className="size-5" />
          {refining ? (
            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />
          ) : null}
        </button>
        {action}
      </div>

      {/* Resumo do que está aplicado, sempre visível. Antes, fechar o
          painel escondia os filtros mas não os desligava — dava pra ficar
          filtrando sem saber. */}
      {refining ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Filtrando por:</span>
          {value.status !== "ALL" ? (
            <button
              type="button"
              onClick={() => set("status", "ALL")}
              title="Remover este filtro"
              className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary"
            >
              {STATUS_LABEL[value.status]}
              <X className="size-3" />
            </button>
          ) : null}
          {value.priority !== "ALL" ? (
            <button
              type="button"
              onClick={() => set("priority", "ALL")}
              title="Remover este filtro"
              className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary"
            >
              {PRIORITY_META[value.priority].label}
              <X className="size-3" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onChange({ ...value, status: "ALL", priority: "ALL" })}
            className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            limpar
          </button>
        </div>
      ) : null}

      <SegmentRow
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
          <SegmentRow
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
          <SegmentRow
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
