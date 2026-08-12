"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { AiSettings } from "@/lib/types";

export function ApiKeyCard({
  settings,
  onUpdated,
}: {
  settings: AiSettings;
  onUpdated: (settings: AiSettings) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [model, setModel] = useState(settings.model ?? "");
  const [savingModel, setSavingModel] = useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const updated = await apiFetch<AiSettings>("/ai/settings", {
        method: "PUT",
        body: JSON.stringify({ apiKey }),
      });
      onUpdated(updated);
      setApiKey("");
      setEditing(false);
      toast.success("Chave salva.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Não deu pra salvar a chave.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveModel(event: React.FormEvent) {
    event.preventDefault();
    setSavingModel(true);
    try {
      const updated = await apiFetch<AiSettings>("/ai/settings", {
        method: "PUT",
        body: JSON.stringify({ model: model || undefined }),
      });
      onUpdated(updated);
      toast.success("Modelo salvo.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Não deu pra salvar o modelo.");
    } finally {
      setSavingModel(false);
    }
  }

  async function handleRemove() {
    try {
      const updated = await apiFetch<AiSettings>("/ai/settings/api-key", { method: "DELETE" });
      onUpdated(updated);
      toast.success("Chave removida.");
    } catch {
      toast.error("Não deu pra remover a chave.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chave de API</CardTitle>
        <CardDescription>
          Cada empresa usa a própria conta do provedor de IA (hoje: Google Gemini) — sua chave nunca é
          compartilhada com outros clientes da plataforma, e fica criptografada no banco.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {editing ? (
          <form onSubmit={handleSave} className="flex flex-col gap-3">
            <Input
              type="password"
              autoFocus
              placeholder="Cole aqui a API key do Google AI Studio"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={saving || !apiKey.trim()}>
                {saving ? "Salvando..." : "Salvar chave"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : settings.hasApiKey ? (
          <div className="flex items-center justify-between">
            <p className="text-sm">
              Configurada, terminando em <span className="font-mono">{settings.apiKeyPreview}</span>
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Trocar chave
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={handleRemove}>
                Remover
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Nenhuma chave configurada — a IA não responde até você adicionar uma.
            </p>
            <Button size="sm" onClick={() => setEditing(true)}>
              Adicionar chave
            </Button>
          </div>
        )}

        <form onSubmit={handleSaveModel} className="mt-4 flex flex-col gap-2 border-t pt-4">
          <label htmlFor="ai-model" className="text-sm font-medium">
            Modelo do Gemini
          </label>
          <p className="text-xs text-muted-foreground">
            O Google descontinua modelos de vez em quando — se a IA parar de responder e o motivo for
            algo como &ldquo;model is no longer available&rdquo;, troque aqui pelo nome atual (confira em{" "}
            <a
              href="https://ai.google.dev/gemini-api/docs/models"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              ai.google.dev/gemini-api/docs/models
            </a>
            ), sem precisar de deploy.
          </p>
          <div className="flex gap-2">
            <Input
              id="ai-model"
              placeholder="gemini-2.5-flash"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="max-w-xs"
            />
            <Button type="submit" size="sm" variant="outline" disabled={savingModel}>
              {savingModel ? "Salvando..." : "Salvar modelo"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
