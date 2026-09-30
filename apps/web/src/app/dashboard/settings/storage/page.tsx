"use client";

import { FileText, HardDrive, Paperclip, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { AVISAR_A_PARTIR_DE, tamanhoLegivel } from "@/lib/armazenamento";
import { cn } from "@/lib/utils";

interface RetentionData {
  settings: {
    keepMessagesDays: number | null;
    autoPurgeOnFull: boolean;
    lastPurgeAt: string | null;
    lastPurgeDeleted: number;
  };
  billing: { planLabel: string; quotaBytes: number };
  usage: {
    usedBytes: number;
    textBytes?: number;
    fileBytes?: number;
    quotaBytes: number;
    messages: number;
    conversations: number;
    customers: number;
  };
}

const humanBytes = tamanhoLegivel;

const PRAZOS = [
  { value: "", label: "Guardar para sempre" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
  { value: "180", label: "6 meses" },
  { value: "365", label: "1 ano" },
  { value: "730", label: "2 anos" },
];

export default function StoragePage() {
  const [data, setData] = useState<RetentionData | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    apiFetch<RetentionData>("/retention")
      .then(setData)
      .catch(() => toast.error("Não deu pra carregar o armazenamento."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    try {
      await apiFetch("/retention", { method: "PATCH", body: JSON.stringify(body) });
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Não deu pra salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function purge() {
    setSaving(true);
    try {
      const result = await apiFetch<{ deleted: number }>("/retention/purge", {
        method: "POST",
      });
      toast.success(
        result.deleted > 0
          ? `${result.deleted} mensagens antigas apagadas.`
          : "Nada fora do prazo pra apagar.",
      );
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Não deu pra limpar.");
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  const { usage, settings, billing } = data;
  const percent = Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100);
  const apertado = percent >= AVISAR_A_PARTIR_DE * 100;
  const textBytes = usage.textBytes ?? usage.usedBytes;
  const fileBytes = usage.fileBytes ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border p-4">
        <h2 className="mb-1 flex items-center gap-2 font-semibold">
          <HardDrive className="size-4" />
          Espaço usado
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Plano {billing.planLabel} — {humanBytes(usage.quotaBytes)} contratados.
        </p>

        {/* Duas cores na mesma barra: arquivos (o que pesa de verdade) e
            texto — pra quem olha saber de onde vem o espaço. */}
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full transition-[width] duration-500",
              apertado ? "bg-amber-500" : "bg-primary",
            )}
            style={{ width: `${Math.max((fileBytes / usage.quotaBytes) * 100, 0)}%` }}
          />
          <div
            className={cn(
              "h-full transition-[width] duration-500",
              apertado ? "bg-amber-500/60" : "bg-primary/50",
            )}
            style={{ width: `${Math.max((textBytes / usage.quotaBytes) * 100, 0.5)}%` }}
          />
        </div>
        <p className="mt-2 text-sm">
          <strong>{humanBytes(usage.usedBytes)}</strong> de {humanBytes(usage.quotaBytes)} (
          {percent.toFixed(1).replace(".", ",")}%)
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Paperclip className="size-3.5" />
            Arquivos (fotos, áudios, documentos): {humanBytes(fileBytes)}
          </span>
          <span className="flex items-center gap-1.5">
            <FileText className="size-3.5" />
            Texto das conversas: {humanBytes(textBytes)}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            { label: "mensagens", value: usage.messages },
            { label: "conversas", value: usage.conversations },
            { label: "clientes", value: usage.customers },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg bg-muted/60 py-2.5">
              <p className="text-base font-semibold tabular-nums">
                {stat.value.toLocaleString("pt-BR")}
              </p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        <p className="mt-4 rounded-md bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
          Tudo o que chega fica guardado aqui, inclusive os arquivos — mesmo depois que somem do
          WhatsApp. O texto ocupa pouco; quem pesa são fotos, áudios e vídeos. Arquivos recebidos
          antes desta medição entram na conta aos poucos, nas próximas horas.
        </p>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 font-semibold">Por quanto tempo guardar</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Passado o prazo, as mensagens são apagadas. A conversa e o cliente continuam — só o
          conteúdo sai.
        </p>

        <div className="flex flex-col gap-4">
          <SelectField
            label="Prazo"
            className="max-w-xs"
            value={settings.keepMessagesDays ? String(settings.keepMessagesDays) : ""}
            onChange={(next) =>
              void patch({ keepMessagesDays: next ? Number(next) : null })
            }
            options={PRAZOS}
          />

          {/* De volta, agora de verdade: a varredura (a cada 6 h, e na
              hora em que é ligado) apaga das mais antigas pras mais novas
              até sobrar 90% — ver RetentionSweepService.liberarEspaco. */}
          <label className="flex items-start gap-3 rounded-lg border p-3">
            <Switch
              checked={settings.autoPurgeOnFull}
              onCheckedChange={(ligado) => void patch({ autoPurgeOnFull: ligado })}
              disabled={saving}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5 text-sm">
              <span className="font-medium">Liberar espaço sozinho quando encher</span>
              <span className="text-xs text-muted-foreground">
                Ao chegar a {humanBytes(usage.quotaBytes)}, as mensagens mais antigas (e os arquivos
                delas) são apagadas, das mais velhas pras mais novas, até sobrar 10% livre. O painel
                avisa a partir de 90%.
              </span>
            </span>
          </label>

          {settings.keepMessagesDays ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={purge} disabled={saving}>
                <Trash2 className="size-4" />
                Limpar agora
              </Button>
              <span className="text-xs text-muted-foreground">
                {settings.lastPurgeAt
                  ? `Última limpeza: ${new Date(settings.lastPurgeAt).toLocaleString("pt-BR")} · ${settings.lastPurgeDeleted} apagadas`
                  : "Ainda não houve limpeza."}
              </span>
            </div>
          ) : null}

          {settings.keepMessagesDays ? (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <span>
                Mensagem apagada não volta. Se o seu setor exige guardar o atendimento por um prazo
                legal, confirme antes de deixar um prazo curto aqui.
              </span>
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
