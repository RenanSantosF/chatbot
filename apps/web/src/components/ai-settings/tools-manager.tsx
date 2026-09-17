"use client";

import {
  ArrowRightLeft,
  CircleCheck,
  CircleX,
  ClipboardList,
  Clock,
  ListChecks,
  NotebookPen,
  Search,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { AiToolPermission, ConfiguredTool } from "@/lib/types";

const PERMISSION_OPTIONS: {
  value: AiToolPermission;
  label: string;
  icon: LucideIcon;
  activeClass: string;
}[] = [
  { value: "ALLOW", label: "Permitir", icon: CircleCheck, activeClass: "bg-emerald-600 text-white" },
  { value: "REQUIRES_APPROVAL", label: "Aprovar", icon: Clock, activeClass: "bg-amber-500 text-white" },
  { value: "DENY", label: "Negar", icon: CircleX, activeClass: "bg-destructive text-white" },
];

/**
 * Um ícone por ferramenta, e não a mesma chave inglesa repetida seis
 * vezes. É o que deixa a lista escaneável de relance — a forma do ícone
 * diz o que a linha faz antes mesmo de ler o nome — em vez de seis
 * blocos de texto cinza do mesmo tamanho, indistinguíveis até o olho
 * parar em cada um.
 */
const TOOL_ICONS: Record<string, LucideIcon> = {
  searchCustomer: Search,
  createTask: ListChecks,
  transferToQueue: ArrowRightLeft,
  resolveConversation: CircleCheck,
  rememberCustomerInfo: NotebookPen,
  collectCustomerData: ClipboardList,
};

export function ToolsManager({
  tools,
  onChange,
}: {
  tools: ConfiguredTool[];
  onChange: (tools: ConfiguredTool[]) => void;
}) {
  async function updateTool(key: string, data: Partial<Pick<ConfiguredTool, "enabled" | "permission">>) {
    try {
      const updated = await apiFetch<ConfiguredTool>(`/ai/tools/${key}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      onChange(tools.map((tool) => (tool.key === key ? updated : tool)));
    } catch {
      toast.error("Não deu pra atualizar a ferramenta.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="size-4" />
          Ferramentas
        </CardTitle>
        <CardDescription>
          O que a IA pode fazer sozinha, o que precisa de aprovação de alguém da equipe, e o que ela nunca
          pode fazer.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {tools.map((tool) => {
          const Icone = TOOL_ICONS[tool.key] ?? Wrench;
          return (
            <div
              key={tool.key}
              className={cn(
                "flex flex-col gap-3 rounded-lg border p-3 transition-opacity sm:flex-row sm:items-center sm:justify-between",
                !tool.enabled && "opacity-60",
              )}
            >
              <div className="flex items-start gap-3">
                <Switch
                  checked={tool.enabled}
                  onCheckedChange={(enabled) => updateTool(tool.key, { enabled })}
                  className="mt-0.5"
                />
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md border",
                    tool.enabled ? "bg-muted text-foreground" : "text-muted-foreground",
                  )}
                  aria-hidden
                >
                  <Icone className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">{tool.name}</p>
                  <p className="text-xs text-muted-foreground">{tool.description}</p>
                </div>
              </div>
              <div className="flex shrink-0 overflow-hidden rounded-md border">
                {PERMISSION_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={!tool.enabled}
                    onClick={() => updateTool(tool.key, { permission: option.value })}
                    title={option.label}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      tool.permission === option.value
                        ? option.activeClass
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <option.icon className="size-3.5" />
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
