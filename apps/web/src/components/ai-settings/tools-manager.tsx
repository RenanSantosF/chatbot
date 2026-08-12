"use client";

import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { AiToolPermission, ConfiguredTool } from "@/lib/types";

const PERMISSION_OPTIONS: { value: AiToolPermission; label: string; activeClass: string }[] = [
  { value: "ALLOW", label: "Permitir", activeClass: "bg-emerald-600 text-white" },
  { value: "REQUIRES_APPROVAL", label: "Aprovar", activeClass: "bg-amber-500 text-white" },
  { value: "DENY", label: "Negar", activeClass: "bg-destructive text-white" },
];

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
        <CardTitle>Ferramentas</CardTitle>
        <CardDescription>
          O que a IA pode fazer sozinha, o que precisa de aprovação de alguém da equipe, e o que ela nunca
          pode fazer.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {tools.map((tool) => (
          <div
            key={tool.key}
            className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-3">
              <Switch
                checked={tool.enabled}
                onCheckedChange={(enabled) => updateTool(tool.key, { enabled })}
                className="mt-0.5"
              />
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
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    tool.permission === option.value ? option.activeClass : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
