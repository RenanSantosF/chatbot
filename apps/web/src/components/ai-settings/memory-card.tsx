"use client";

import { Brain } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { AiMemoryMode, AiSettings } from "@/lib/types";

const OPTIONS: { value: AiMemoryMode; label: string; description: string }[] = [
  {
    value: "NONE",
    label: "Nada",
    description:
      "A IA não guarda nada sobre o cliente e também não usa o que já foi guardado antes. Cada conversa começa do zero.",
  },
  {
    value: "IMPORTANT_ONLY",
    label: "Só o importante",
    description:
      "Guarda o essencial pra atender melhor da próxima vez — profissão, como a pessoa prefere ser chamada, assunto recorrente.",
  },
  {
    value: "FULL",
    label: "Detalhes",
    description:
      "Guarda também detalhes gerais úteis que aparecerem na conversa. Mais contexto, mais dado armazenado.",
  },
];

/**
 * Quem decide o que fica registrado do cliente é a empresa, não a IA. Vale
 * lembrar que isso é dado pessoal de terceiros: quanto menos guardar, menor
 * a responsabilidade da empresa sobre ele.
 */
export function MemoryCard({
  settings,
  onUpdated,
}: {
  settings: AiSettings;
  onUpdated: (settings: AiSettings) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function handleSelect(memoryMode: AiMemoryMode) {
    if (memoryMode === settings.memoryMode || saving) return;
    setSaving(true);
    try {
      const updated = await apiFetch<AiSettings>("/ai/settings", {
        method: "PATCH",
        body: JSON.stringify({ memoryMode }),
      });
      onUpdated(updated);
      toast.success("Memória da IA atualizada.");
    } catch {
      toast.error("Não deu pra salvar essa configuração.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="size-4" />
          Memória do cliente
        </CardTitle>
        <CardDescription>
          O que a IA pode guardar sobre quem conversa com ela, pra lembrar nos próximos atendimentos.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {OPTIONS.map((option) => {
          const active = settings.memoryMode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSelect(option.value)}
              disabled={saving}
              aria-pressed={active}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
                active ? "border-primary bg-primary/5" : "hover:bg-muted/60",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                  active ? "border-primary" : "border-muted-foreground/40",
                )}
                aria-hidden
              >
                {active ? <span className="size-2 rounded-full bg-primary" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground text-pretty">{option.description}</span>
              </span>
            </button>
          );
        })}
        <p className="mt-1 text-xs text-muted-foreground">
          A IA é instruída a nunca guardar senha, cartão ou algo que o cliente peça pra não registrar. O que
          já estiver guardado aparece no painel do cliente, dentro da conversa.
        </p>
      </CardContent>
    </Card>
  );
}
