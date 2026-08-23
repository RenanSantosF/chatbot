"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiKeyCard } from "@/components/ai-settings/api-key-card";
import { IdentityForm } from "@/components/ai-settings/identity-form";
import { MemoryCard } from "@/components/ai-settings/memory-card";
import { PageSkeleton } from "@/components/page-skeleton";
import { Simulator } from "@/components/ai-settings/simulator";
import { ToolsManager } from "@/components/ai-settings/tools-manager";
import { apiFetch } from "@/lib/api-client";
import type { AiSettings, ConfiguredTool } from "@/lib/types";

export default function AiSettingsPage() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [tools, setTools] = useState<ConfiguredTool[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [settingsResult, toolsResult] = await Promise.all([
          apiFetch<AiSettings>("/ai/settings"),
          apiFetch<ConfiguredTool[]>("/ai/tools"),
        ]);
        setSettings(settingsResult);
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

      {loading || !settings ? (
        <PageSkeleton rows={3} />
      ) : (
        <>
          <IdentityForm settings={settings} onUpdated={setSettings} />
          <ApiKeyCard settings={settings} onUpdated={setSettings} />
          <MemoryCard settings={settings} onUpdated={setSettings} />
          <ToolsManager tools={tools} onChange={setTools} />
          <Simulator />
        </>
      )}
    </div>
  );
}
