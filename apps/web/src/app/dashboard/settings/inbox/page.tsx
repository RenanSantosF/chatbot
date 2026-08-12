"use client";

import { CheckCheck, MessageSquareX } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    </div>
  );
}
