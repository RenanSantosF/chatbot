"use client";

import { CheckCheck, Clock3, Inbox, Search, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { PRIORITY_META, PRIORITY_ORDER } from "@/lib/priority";
import { cn } from "@/lib/utils";
import type { ConversationPriority, ConversationStatus } from "@/lib/types";

/** Os três grupos de trabalho vindos da API (ver STATUS_GROUPS no backend). */
export type StatusGroup = "PENDING" | "WAITING" | "DONE";

export interface InboxFilters {
  /** Grupo de trabalho. "ALL" = não filtra. */
  grupo: StatusGroup | "ALL";
  status: ConversationStatus | "ALL";
  priority: ConversationPriority | "ALL";
  mine: boolean;
  unread: boolean;
  unassigned: boolean;
  /** Só o que a IA está conduzindo agora. */
  comIa: boolean;
  search: string;
}

/**
 * Abre em "Pendentes", não em "Tudo".
 *
 * A tela existe pra responder "o que eu preciso fazer agora". Abrir com
 * tudo misturado — inclusive o que já foi resolvido — obriga a pessoa a
 * filtrar antes de começar a trabalhar, todo dia.
 */
export const DEFAULT_FILTERS: InboxFilters = {
  grupo: "PENDING",
  status: "ALL",
  priority: "ALL",
  mine: false,
  unread: false,
  unassigned: false,
  comIa: false,
  search: "",
};

/** Contagens vindas do servidor — refletem a base inteira, não a página. */
export interface FilterCounts {
  total: number;
  unread: number;
  mine: number;
  unassigned: number;
  comIa: number;
  pendentes: number;
  aguardando: number;
  resolvidas: number;
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

const GRUPOS: {
  value: StatusGroup | "ALL";
  label: string;
  icon: typeof Inbox;
  ajuda: string;
}[] = [
  {
    value: "PENDING",
    label: "Pendentes",
    icon: Inbox,
    ajuda: "Precisa de uma pessoa — sem o que a IA está conduzindo",
  },
  {
    value: "WAITING",
    label: "Aguardando",
    icon: Clock3,
    ajuda: "Dentro de Pendentes: a bola está com o cliente",
  },
  {
    value: "DONE",
    label: "Resolvidas",
    icon: CheckCheck,
    ajuda: "Atendimento encerrado",
  },
  { value: "ALL", label: "Tudo", icon: SlidersHorizontal, ajuda: "Sem filtro de situação" },
];

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
  const [maisAberto, setMaisAberto] = useState(
    value.status !== "ALL" || value.priority !== "ALL",
  );

  const set = <K extends keyof InboxFilters>(key: K, next: InboxFilters[K]) =>
    onChange({ ...value, [key]: next });

  const contagemDoGrupo: Record<StatusGroup | "ALL", number> = {
    PENDING: counts.pendentes,
    WAITING: counts.aguardando,
    DONE: counts.resolvidas,
    ALL: counts.total,
  };

  const refinando =
    value.status !== "ALL" ||
    value.priority !== "ALL" ||
    value.mine ||
    value.unread ||
    value.unassigned ||
    value.comIa;

  return (
    <div className="flex flex-col gap-2.5 p-3">
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
        {action}
      </div>

      {/* Grade de 4, não fila rolável. A versão anterior usava rolagem
          horizontal com a barra escondida: "Sem dono" ficava cortado na
          borda e não havia nada indicando que dava pra rolar. Em grade
          todas as opções cabem sempre, e a largura é previsível. */}
      <div role="radiogroup" aria-label="Situação do atendimento" className="grid grid-cols-4 gap-1">
        {GRUPOS.map((grupo) => {
          const ativo = value.grupo === grupo.value;
          const quantos = contagemDoGrupo[grupo.value];
          return (
            <button
              key={grupo.value}
              type="button"
              role="radio"
              aria-checked={ativo}
              title={grupo.ajuda}
              onClick={() => set("grupo", grupo.value)}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 transition-colors",
                ativo
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="flex items-center gap-1">
                <grupo.icon className="size-3.5 shrink-0" />
                <span className="text-[15px] leading-none font-semibold tabular-nums">
                  {quantos}
                </span>
              </span>
              <span className="text-[11px] leading-tight font-medium">{grupo.label}</span>
            </button>
          );
        })}
      </div>

      {/* Recortes que se somam ao grupo, como interruptores. Antes eram
          opções exclusivas na mesma fila do grupo, então não dava pra ver
          "minhas pendentes" — escolher uma desligava a outra. */}
      <div className="flex flex-wrap gap-1">
        <Interruptor
          ligado={value.mine}
          onToggle={() => set("mine", !value.mine)}
          rotulo="Minhas"
          quantos={counts.mine}
        />
        <Interruptor
          ligado={value.unread}
          onToggle={() => set("unread", !value.unread)}
          rotulo="Não lidas"
          quantos={counts.unread}
        />
        <Interruptor
          ligado={value.unassigned}
          onToggle={() => set("unassigned", !value.unassigned)}
          rotulo="Sem dono"
          quantos={counts.unassigned}
        />
        {/* Fora de "Pendentes" por padrão: conversa que a IA conduz não
            espera ninguém da equipe. Este interruptor é o caminho de quem
            quer justamente auditar o que ela anda respondendo. */}
        <Interruptor
          ligado={value.comIa}
          onToggle={() => set("comIa", !value.comIa)}
          rotulo="Com a IA"
          quantos={counts.comIa}
        />
        <button
          type="button"
          aria-pressed={maisAberto}
          onClick={() => setMaisAberto((aberto) => !aberto)}
          className={cn(
            "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
            value.status !== "ALL" || value.priority !== "ALL"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <SlidersHorizontal className="size-3.5" />
          Mais
        </button>
        {refinando ? (
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_FILTERS, grupo: value.grupo, search: value.search })}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            limpar
          </button>
        ) : null}
      </div>

      {maisAberto ? (
        <div className="flex flex-col gap-2 duration-200 animate-in fade-in slide-in-from-top-1">
          <Grupo
            titulo="Situação exata"
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
          <Grupo
            titulo="Prioridade"
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

function Interruptor({
  ligado,
  onToggle,
  rotulo,
  quantos,
}: {
  ligado: boolean;
  onToggle: () => void;
  rotulo: string;
  quantos: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={ligado}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        ligado
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {ligado ? <X className="size-3" /> : null}
      {rotulo}
      <span className="tabular-nums opacity-70">{quantos}</span>
    </button>
  );
}

/**
 * Filtro secundário em linhas que QUEBRAM, não que rolam. Rolagem
 * horizontal escondida some com opção sem avisar; quebrar linha custa
 * altura, mas mostra tudo o que existe.
 */
function Grupo({
  titulo,
  value,
  options,
  onChange,
}: {
  titulo: string;
  value: string;
  options: { value: string; label: string; count?: number; dot?: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {titulo}
      </span>
      <div role="radiogroup" aria-label={titulo} className="flex flex-wrap gap-1">
        {options.map((option) => {
          const ativo = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={ativo}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors",
                ativo
                  ? "bg-primary/15 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {option.dot ? (
                <span className={cn("size-1.5 rounded-full", option.dot)} aria-hidden />
              ) : null}
              {option.label}
              {option.count ? (
                <span className="tabular-nums opacity-70">{option.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
