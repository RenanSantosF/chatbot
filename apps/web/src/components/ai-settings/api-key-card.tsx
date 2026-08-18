"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { AiSettings } from "@/lib/types";

interface CatalogoDeModelos {
  modelos: { id: string; rotulo: string; recomendado: boolean }[];
  /** O modelo que a API usa quando a empresa não escolheu nenhum. */
  padrao: string;
  /** A lista veio do Google, ou é a recomendada de reserva? */
  verificado: boolean;
}

/**
 * O valor que abre o campo de texto.
 *
 * Um id de modelo nunca tem espaço, então não há como colidir com um nome
 * de verdade vindo do Google.
 */
const OUTRO = "outro modelo";

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
  const [catalogo, setCatalogo] = useState<CatalogoDeModelos | null>(null);
  const [outro, setOutro] = useState(false);

  /*
   * O catálogo é buscado uma vez, na montagem do cartão.
   *
   * A consulta sai daqui pra API e de lá pro Google com a chave da
   * empresa — a chave nunca chega ao navegador. Falhar não trava nada: o
   * servidor devolve os recomendados e a tela segue funcionando (ver
   * AiSettingsService.listarModelos).
   */
  useEffect(() => {
    apiFetch<CatalogoDeModelos>("/ai/settings/modelos")
      .then(setCatalogo)
      .catch(() => setCatalogo(null));
  }, []);

  /*
   * O que aparece no seletor.
   *
   * O modelo GRAVADO entra na lista mesmo quando não está no catálogo:
   * sem isso, uma empresa que escolheu um modelo hoje aposentado abriria
   * a tela e veria outro selecionado — e sairia achando que estava usando
   * aquele. Melhor mostrar o que está valendo, ainda que marcado.
   */
  const opcoes = useMemo(() => {
    const padrao = catalogo?.padrao ?? "";
    const disponiveis = catalogo?.modelos ?? [];
    const lista = disponiveis.map((m) => ({
      value: m.id,
      label: m.recomendado ? `${m.rotulo} — recomendado` : m.rotulo,
    }));

    const atual = model || padrao;
    if (atual && !disponiveis.some((m) => m.id === atual)) {
      lista.unshift({ value: atual, label: `${atual} — fora da lista` });
    }

    return [...lista, { value: OUTRO, label: "Outro modelo…" }];
  }, [catalogo, model]);

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
          <span className="text-sm font-medium">Modelo do Gemini</span>
          <p className="text-xs text-muted-foreground">
            {catalogo?.verificado
              ? "Os modelos que a sua chave alcança, perguntados ao Google agora. Os recomendados para atendimento vêm primeiro."
              : "Modelos recomendados para atendimento. Configure a chave para ver a lista completa da sua conta."}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <SelectField
              title="Modelo do Gemini"
              className="max-w-xs flex-1"
              // Sem escolha gravada, o seletor mostra o padrão da API — o
              // mesmo que ela vai usar de fato. Deixar vazio faria o
              // navegador exibir a primeira opção enquanto o valor
              // controlado dizia outra coisa.
              value={outro ? OUTRO : model || catalogo?.padrao || ""}
              options={opcoes}
              onChange={(next) => {
                if (next === OUTRO) return setOutro(true);
                setOutro(false);
                setModel(next);
              }}
            />
            <Button type="submit" size="sm" variant="outline" disabled={savingModel}>
              {savingModel ? "Salvando..." : "Salvar modelo"}
            </Button>
          </div>

          {/* A saída de emergência. O Google lança modelo sem avisar, e um
              seletor fechado transformaria "quero usar o que saiu ontem"
              numa espera por deploy — que é justamente o que este campo
              existe pra evitar. */}
          {outro ? (
            <Input
              id="ai-model"
              autoFocus
              placeholder={catalogo?.padrao ?? "gemini-3.1-flash-lite"}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="max-w-xs"
            />
          ) : null}

          <p className="text-xs text-muted-foreground">
            Se a IA parar de responder com algo como &ldquo;model is no longer
            available&rdquo;, o Google aposentou esse modelo — escolha outro aqui, sem
            precisar de deploy. A lista completa fica em{" "}
            <a
              href="https://ai.google.dev/gemini-api/docs/models"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              ai.google.dev/gemini-api/docs/models
            </a>
            .
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
