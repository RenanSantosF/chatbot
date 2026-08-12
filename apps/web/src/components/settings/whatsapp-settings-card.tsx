"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { WhatsAppSettings } from "@/lib/types";

export function WhatsAppSettingsCard({
  settings,
  onUpdated,
}: {
  settings: WhatsAppSettings;
  onUpdated: (settings: WhatsAppSettings) => void;
}) {
  const [editing, setEditing] = useState(!settings.connected);
  const [phoneNumberId, setPhoneNumberId] = useState(settings.phoneNumberId ?? "");
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState(settings.displayPhoneNumber ?? "");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!phoneNumberId.trim()) return;
    setSaving(true);
    try {
      const updated = await apiFetch<WhatsAppSettings>("/whatsapp/settings", {
        method: "PUT",
        body: JSON.stringify({
          phoneNumberId,
          displayPhoneNumber: displayPhoneNumber || undefined,
          accessToken: accessToken || undefined,
          appSecret: appSecret || undefined,
        }),
      });
      onUpdated(updated);
      setAccessToken("");
      setAppSecret("");
      setEditing(false);
      toast.success("WhatsApp configurado.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Não deu pra salvar as credenciais.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    try {
      const updated = await apiFetch<WhatsAppSettings>("/whatsapp/settings", { method: "DELETE" });
      onUpdated(updated);
      toast.success("WhatsApp desconectado.");
    } catch {
      toast.error("Não deu pra desconectar.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>WhatsApp</CardTitle>
          <Badge variant={settings.connected ? "default" : "outline"}>
            {settings.connected ? "Conectado" : "Não conectado"}
          </Badge>
        </div>
        <CardDescription>
          Cada empresa usa seu próprio app no Meta Developers e seu próprio número — as credenciais nunca
          são compartilhadas entre clientes da plataforma.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="font-medium">Antes de começar, no Meta Developers:</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>Crie um app do tipo Business e adicione o produto WhatsApp.</li>
            <li>
              Em WhatsApp &gt; Configuração, copie o <span className="font-medium">Phone number ID</span> e
              gere um <span className="font-medium">token de acesso permanente</span> (via um usuário do
              sistema, não o token temporário de teste).
            </li>
            <li>
              Em Configurações do app, copie o <span className="font-medium">App Secret</span>.
            </li>
            <li>
              Configure o webhook apontando pra{" "}
              <span className="font-mono text-xs">{settings.webhookUrl}</span> com o verify token combinado
              com quem administra a plataforma, e inscreva o campo{" "}
              <span className="font-mono text-xs">messages</span>.
            </li>
          </ol>
        </div>

        {editing ? (
          <form onSubmit={handleSave} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="phoneNumberId" className="text-xs">
                Phone number ID
              </Label>
              <Input
                id="phoneNumberId"
                autoFocus
                placeholder="Ex: 109876543210987"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="displayPhoneNumber" className="text-xs">
                Número (só pra exibição, opcional)
              </Label>
              <Input
                id="displayPhoneNumber"
                placeholder="Ex: +55 11 91234-5678"
                value={displayPhoneNumber}
                onChange={(e) => setDisplayPhoneNumber(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="accessToken" className="text-xs">
                Token de acesso {settings.hasAccessToken ? "(deixe em branco pra manter o atual)" : ""}
              </Label>
              <Input
                id="accessToken"
                type="password"
                placeholder="EAAG..."
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="appSecret" className="text-xs">
                App Secret {settings.hasAppSecret ? "(deixe em branco pra manter o atual)" : ""}
              </Label>
              <Input
                id="appSecret"
                type="password"
                placeholder="32 caracteres"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={saving || !phoneNumberId.trim()}>
                {saving ? "Salvando..." : "Salvar"}
              </Button>
              {settings.connected ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <p className="font-medium">{settings.displayPhoneNumber ?? settings.phoneNumberId}</p>
              <p className="text-muted-foreground">Phone number ID: {settings.phoneNumberId}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Editar
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={handleDisconnect}>
                Desconectar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
