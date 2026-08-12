"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiKeyCard } from "@/components/ai-settings/api-key-card";
import { IdentityForm } from "@/components/ai-settings/identity-form";
import { InstructionsManager } from "@/components/ai-settings/instructions-manager";
import { Simulator } from "@/components/ai-settings/simulator";
import { ToolsManager } from "@/components/ai-settings/tools-manager";
import { apiFetch } from "@/lib/api-client";
import type { AiInstruction, AiSettings, ConfiguredTool } from "@/lib/types";

export default function AiSettingsPage() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [instructions, setInstructions] = useState<AiInstruction[]>([]);
  const [tools, setTools] = useState<ConfiguredTool[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [settingsResult, instructionsResult, toolsResult] = await Promise.all([
          apiFetch<AiSettings>("/ai/settings"),
          apiFetch<AiInstruction[]>("/ai/instructions"),
          apiFetch<ConfiguredTool[]>("/ai/tools"),
        ]);
        setSettings(settingsResult);
        setInstructions(instructionsResult);
        setTools(toolsResult);
      } catch {
        toast.error("Não deu pra carregar as configurações da IA.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">IA</h1>
        <p className="text-muted-foreground">Configure quem é sua IA e o que ela sabe.</p>
      </div>

      {loading || !settings ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <>
          <IdentityForm settings={settings} onUpdated={setSettings} />
          <ApiKeyCard settings={settings} onUpdated={setSettings} />
          <ToolsManager tools={tools} onChange={setTools} />
          <InstructionsManager instructions={instructions} onChange={setInstructions} />
          <Simulator />
        </>
      )}
    </div>
  );
}
