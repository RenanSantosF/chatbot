"use client";

import { CheckCheck, Clock, Layers, MessageSquareX } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageSkeleton } from "@/components/page-skeleton";
import { apiFetch } from "@/lib/api-client";
import type { InboxSettings } from "@/lib/types";

export default function InboxSettingsPage() {
  const [settings, setSettings] = useState<InboxSettings | null>(null);
  const [message, setMessage] = useState("");
  const [savingMessage, setSavingMessage] = useState(false);

  useEffect(() => {
    apiFetch<InboxSettings>("/inbox-settings")
      .then((result) => {
        setSettings(result);
        setMessage(result.resolveMessage);
      })
      .catch(() => toast.error("Não deu pra carregar as configurações."));
  }, []);

  async function patch(body: Partial<InboxSettings>) {
    try {
      const updated = await apiFetch<InboxSettings>("/inbox-settings", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setSettings(updated);
      return updated;
    } catch {
      toast.error("Não deu pra salvar.");
      return null;
    }
  }

  async function handleSaveMessage() {
    setSavingMessage(true);
    const updated = await patch({ resolveMessage: message.trim() });
    if (updated) toast.success("Mensagem de encerramento salva.");
    setSavingMessage(false);
  }

  if (!settings) return <PageSkeleton rows={2} />;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCheck className="size-4" />
            Confirmação de leitura
          </CardTitle>
          <CardDescription>
            Quando ligada, abrir a conversa no painel acende o tique azul no aparelho do cliente — ele vê
            que a mensagem foi lida.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-center justify-between gap-4 rounded-md border p-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Marcar mensagens como lidas</span>
              <span className="block text-xs text-muted-foreground text-pretty">
                Desligue se preferir que o cliente não saiba que a mensagem já foi vista antes de a equipe
                conseguir responder.
              </span>
            </span>
            <Switch
              checked={settings.sendReadReceipts}
              onCheckedChange={(checked) => patch({ sendReadReceipts: checked })}
              aria-label="Enviar confirmação de leitura"
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareX className="size-4" />
            Aviso de encerramento
          </CardTitle>
          <CardDescription>
            Ao clicar em &ldquo;Resolver&rdquo;, o cliente recebe esta mensagem avisando que o atendimento
            foi encerrado — sem ela, ele fica esperando uma resposta que não vem.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-4 rounded-md border p-3">
            <span className="text-sm font-medium">Avisar o cliente ao resolver</span>
            <Switch
              checked={settings.notifyOnResolve}
              onCheckedChange={(checked) => patch({ notifyOnResolve: checked })}
              aria-label="Avisar ao resolver"
            />
          </label>

          {settings.notifyOnResolve ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="resolve-message" className="text-xs">
                Mensagem enviada
              </Label>
              <Textarea
                id="resolve-message"
                rows={3}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={1000}
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveMessage}
                  disabled={
                    savingMessage ||
                    message.trim().length < 5 ||
                    message.trim() === settings.resolveMessage
                  }
                >
                  {savingMessage ? <Spinner /> : null}
                  Salvar mensagem
                </Button>
                <span className="text-xs text-muted-foreground">{message.length}/1000</span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="size-4" />
            Agrupar conversas do mesmo cliente
          </CardTitle>
          <CardDescription>
            Quem volta a escrever depois de um assunto encerrado cai na mesma conversa, com o histórico à
            vista — como acontece no WhatsApp de verdade. Desligado, cada assunto vira um atendimento
            separado.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-4 rounded-md border p-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Reabrir a conversa anterior</span>
              <span className="block text-xs text-muted-foreground text-pretty">
                Sem isto, quem atende a segunda mensagem não vê o que foi combinado na primeira.
              </span>
            </span>
            <Switch
              checked={settings.groupByCustomer}
              onCheckedChange={(checked) => patch({ groupByCustomer: checked })}
              aria-label="Agrupar conversas do mesmo cliente"
            />
          </label>

          {settings.groupByCustomer ? (
            <NumberField
              id="group-window"
              label="Agrupar se voltar em até"
              sufixo="horas"
              value={settings.groupWindowHours}
              min={1}
              max={720}
              ajuda="Passado esse tempo, o assunto é outro e a conversa começa limpa. O histórico continua no perfil do cliente."
              onSave={(valor) => patch({ groupWindowHours: valor })}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4" />
            Encerrar assuntos parados
          </CardTitle>
          <CardDescription>
            O WhatsApp cobra pra retomar uma conversa parada há mais de 24 horas: passado esse prazo,
            responder exige um modelo aprovado pela Meta. Encerrar antes disso evita deixar assunto
            pendurado até virar custo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-4 rounded-md border p-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Encerrar sozinho por inatividade</span>
              <span className="block text-xs text-muted-foreground text-pretty">
                Marca como resolvida e deixa uma nota na conversa. O cliente não é avisado — se ele
                escrever de novo, o atendimento reabre normalmente.
              </span>
            </span>
            <Switch
              checked={settings.autoCloseIdle}
              onCheckedChange={(checked) => patch({ autoCloseIdle: checked })}
              aria-label="Encerrar conversas paradas"
            />
          </label>

          {settings.autoCloseIdle ? (
            <NumberField
              id="auto-close"
              label="Encerrar depois de"
              sufixo="horas sem movimento"
              value={settings.autoCloseHours}
              min={1}
              max={23}
              ajuda="No máximo 23: o objetivo é encerrar antes das 24 horas da janela do WhatsApp."
              onSave={(valor) => patch({ autoCloseHours: valor })}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Campo numérico com salvar próprio. Não salva a cada tecla de propósito:
 * digitar "12" passa por "1", e salvar o "1" mudaria a configuração pra um
 * valor que ninguém escolheu.
 */
function NumberField({
  id,
  label,
  sufixo,
  value,
  min,
  max,
  ajuda,
  onSave,
}: {
  id: string;
  label: string;
  sufixo: string;
  value: number;
  min: number;
  max: number;
  ajuda: string;
  onSave: (valor: number) => Promise<unknown>;
}) {
  const [rascunho, setRascunho] = useState(String(value));
  const [salvando, setSalvando] = useState(false);

  const numero = Number(rascunho);
  const valido = Number.isInteger(numero) && numero >= min && numero <= max;
  const mudou = valido && numero !== value;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          value={rascunho}
          onChange={(event) => setRascunho(event.target.value)}
          className="h-9 w-24"
        />
        <span className="text-sm text-muted-foreground">{sufixo}</span>
        <Button
          size="sm"
          variant="outline"
          disabled={!mudou || salvando}
          onClick={async () => {
            setSalvando(true);
            await onSave(numero);
            setSalvando(false);
          }}
        >
          {salvando ? <Spinner /> : null}
          Salvar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground text-pretty">{ajuda}</p>
      {!valido ? (
        <p className="text-xs text-destructive">
          Informe um número inteiro entre {min} e {max}.
        </p>
      ) : null}
    </div>
  );
}
