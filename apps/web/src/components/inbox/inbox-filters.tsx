"use client";

import { ArrowDownWideNarrow, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/priority";
import { cn } from "@/lib/utils";
import type { ConversationPriority, ConversationStatus } from "@/lib/types";

export interface InboxFilters {
  status: ConversationStatus | "ALL";
  priority: ConversationPriority | "ALL";
  mine: boolean;
  unreadOnly: boolean;
  sort: "recent" | "priority";
  search: string;
}

export const DEFAULT_FILTERS: InboxFilters = {
  status: "ALL",
  priority: "ALL",
  mine: false,
  unreadOnly: false,
  sort: "recent",
  search: "",
};

const STATUS_OPTIONS: { value: ConversationStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todas" },
  { value: "OPEN", label: "Abertas" },
  { value: "WAITING_AGENT", label: "Aguard. atendente" },
  { value: "WAITING_CUSTOMER", label: "Aguard. cliente" },
  { value: "RESOLVED", label: "Resolvidas" },
];

function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function InboxFilterBar({
  value,
  onChange,
}: {
  value: InboxFilters;
  onChange: (filters: InboxFilters) => void;
}) {
  const set = <K extends keyof InboxFilters>(key: K, next: InboxFilters[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="flex flex-col gap-2 border-b p-3">
      <Input
        value={value.search}
        onChange={(event) => set("search", event.target.value)}
        placeholder="Buscar por nome ou telefone..."
        className="h-8 text-xs"
      />

      <div className="flex flex-wrap gap-1">
        {STATUS_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            active={value.status === option.value}
            onClick={() => set("status", option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        <Chip active={value.priority === "ALL"} onClick={() => set("priority", "ALL")}>
          Toda prioridade
        </Chip>
        {PRIORITY_ORDER.map((priority) => (
          <Chip
            key={priority}
            active={value.priority === priority}
            onClick={() => set("priority", priority)}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                value.priority === priority ? "bg-primary-foreground" : PRIORITY_META[priority].dot,
              )}
              aria-hidden
            />
            {PRIORITY_META[priority].short}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        <Chip active={value.mine} onClick={() => set("mine", !value.mine)}>
          {value.mine ? <Check className="size-3" /> : null}
          Minhas
        </Chip>
        <Chip active={value.unreadOnly} onClick={() => set("unreadOnly", !value.unreadOnly)}>
          {value.unreadOnly ? <Check className="size-3" /> : null}
          Não lidas
        </Chip>
        <Chip
          active={value.sort === "priority"}
          onClick={() => set("sort", value.sort === "priority" ? "recent" : "priority")}
        >
          <ArrowDownWideNarrow className="size-3" />
          Urgentes primeiro
        </Chip>
      </div>
    </div>
  );
}
