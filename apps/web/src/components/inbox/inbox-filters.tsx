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
}: {
  value: InboxFilters;
  counts: FilterCounts;
  onChange: (filters: InboxFilters) => void;
}) {
  const set = <K extends keyof InboxFilters>(key: K, next: InboxFilters[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="flex flex-col gap-2.5 border-b p-3">
      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value.search}
          onChange={(event) => set("search", event.target.value)}
          placeholder="Buscar nome ou telefone"
          className="h-8 pl-7 text-xs"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <SelectField
          label="Situação"
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
          label="Prioridade"
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
          label="Mostrar"
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
