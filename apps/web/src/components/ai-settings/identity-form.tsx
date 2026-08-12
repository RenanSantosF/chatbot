"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { AiSettings, AiTone } from "@/lib/types";

const TONE_OPTIONS: { value: AiTone; label: string }[] = [
  { value: "PROFESSIONAL", label: "Profissional" },
  { value: "FRIENDLY", label: "Amigável" },
  { value: "CASUAL", label: "Informal" },
  { value: "OBJECTIVE", label: "Objetivo" },
  { value: "WARM", label: "Acolhedor" },
];

export function IdentityForm({
  settings,
  onUpdated,
}: {
  settings: AiSettings;
  onUpdated: (settings: AiSettings) => void;
}) {
  const [aiName, setAiName] = useState(settings.aiName);
  const [tone, setTone] = useState<AiTone>(settings.tone);
  const [active, setActive] = useState(settings.active);
  const [customInstructions, setCustomInstructions] = useState(settings.customInstructions ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await apiFetch<AiSettings>("/ai/settings", {
        method: "PUT",
        body: JSON.stringify({ aiName, tone, active, customInstructions }),
      });
      onUpdated(updated);
      toast.success("Configurações salvas.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Não deu pra salvar agora.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Identidade e comportamento</CardTitle>
          <CardDescription>Como sua IA se apresenta e fala com os clientes.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="ai-active" className="text-sm text-muted-foreground">
            {active ? "IA ativa" : "IA desligada"}
          </Label>
          <Switch id="ai-active" checked={active} onCheckedChange={setActive} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-name">Nome da IA</Label>
            <Input id="ai-name" value={aiName} onChange={(e) => setAiName(e.target.value)} maxLength={60} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Tom de voz</Label>
            <div className="flex flex-wrap gap-2">
              {TONE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTone(option.value)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm transition-colors",
                    tone === option.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ai-custom-instructions">Instruções gerais</Label>
          <Textarea
            id="ai-custom-instructions"
            rows={4}
            placeholder="Ex: fale sempre de forma simples, sem termos técnicos."
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
          />
        </div>
        <div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
