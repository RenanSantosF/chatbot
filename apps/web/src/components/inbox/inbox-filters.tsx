"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/priority";
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
  const set = <K extends keyof InboxFilters>(key: K, next: InboxFilters[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="flex flex-col gap-2.5 border-b p-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value.search}
            onChange={(event) => set("search", event.target.value)}
            placeholder="Buscar nome ou telefone"
            className="h-8 pl-7 text-xs"
          />
        </div>
        {action}
      </div>

      {/* Sem rótulo em cima de cada seletor: três rótulos empilhados
          roubavam altura da lista de conversas. O que cada um filtra fica
          no title/aria-label — o texto visível precisa caber em 1/3 de uma
          coluna de 340px sem cortar a contagem. */}
      <div className="grid grid-cols-3 gap-1.5">
        <SelectField
          title="Filtrar por situação"
          value={value.status}
          onChange={(next) => set("status", next as InboxFilters["status"])}
          options={[
            { value: "ALL", label: "Todas", count: counts.total },
            ...STATUS_ORDER.map((status) => ({
              value: status,
              label: STATUS_LABEL[status],
              count: counts.status[status] ?? 0,
            })),
          ]}
        />
        <SelectField
          title="Filtrar por prioridade"
          value={value.priority}
          onChange={(next) => set("priority", next as InboxFilters["priority"])}
          options={[
            { value: "ALL", label: "Todas", count: counts.total },
            ...PRIORITY_ORDER.map((priority) => ({
              value: priority,
              label: PRIORITY_META[priority].label,
              count: counts.priority[priority] ?? 0,
            })),
          ]}
        />
        <SelectField
          title="Mostrar quais conversas"
          value={value.scope}
          onChange={(next) => set("scope", next as InboxFilters["scope"])}
          options={[
            { value: "ALL", label: "Tudo", count: counts.total },
            { value: "UNREAD", label: "Não lidas", count: counts.unread },
            { value: "MINE", label: "Minhas", count: counts.mine },
            { value: "UNASSIGNED", label: "Sem dono", count: counts.unassigned },
          ]}
        />
      </div>
    </div>
  );
}
