"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConectarWhatsApp } from "@/components/settings/conectar-whatsapp";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { WhatsAppSettings } from "@/lib/types";

// Versões "sem moldura" usadas quando o cartão é embutido dentro de outro:
// mantêm o mesmo conteúdo sem duplicar borda, fundo e espaçamento.
function EmbeddedFrame({ children }: { children?: React.ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

function EmbeddedHeader({ children }: { children?: React.ReactNode }) {
  return <div className="flex flex-col gap-1">{children}</div>;
}

function EmbeddedBody({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

export function WhatsAppSettingsCard({
  settings,
  onUpdated,
  embedded = false,
}: {
  settings: WhatsAppSettings;
  onUpdated: (settings: WhatsAppSettings) => void;
  /** Dentro de outro cartão (Configurações), sem a moldura própria. */
  embedded?: boolean;
}) {
  const [editing, setEditing] = useState(!settings.connected);
  const [phoneNumberId, setPhoneNumberId] = useState(settings.phoneNumberId ?? "");
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState(settings.displayPhoneNumber ?? "");
  const [wabaId, setWabaId] = useState(settings.wabaId ?? "");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

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
          wabaId: wabaId || undefined,
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

  async function handleSubscribe() {
    setSubscribing(true);
    try {
      const updated = await apiFetch<WhatsAppSettings>("/whatsapp/settings/subscribe", { method: "POST" });
      onUpdated(updated);
      setWabaId(updated.wabaId ?? "");
      toast.success("Recebimento de mensagens ativado! Manda uma mensagem de teste pra confirmar.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Não deu pra ativar o recebimento.");
    } finally {
      setSubscribing(false);
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

  const Frame = embedded ? EmbeddedFrame : Card;
  const Header = embedded ? EmbeddedHeader : CardHeader;
  const Body = embedded ? EmbeddedBody : CardContent;

  return (
    <Frame>
      <Header>
        <div className="flex items-center justify-between">
          <CardTitle>WhatsApp</CardTitle>
          <Badge variant={settings.connected ? "default" : "outline"}>
            {settings.connected ? "Conectado" : "Não conectado"}
          </Badge>
        </div>
        <CardDescription>
          Conecte em um clique, autorizando pelo Facebook. As credenciais nunca são compartilhadas
          entre clientes da plataforma.
        </CardDescription>
      </Header>
      <Body className="flex flex-col gap-4">
        {/* O caminho de um clique vem primeiro; o manual vira alternativa.
            O componente some sozinho quando a plataforma ainda não está
            credenciada como Tech Provider — aí só resta o manual mesmo. */}
        {!settings.connected ? (
          <ConectarWhatsApp onConectado={onUpdated} />
        ) : null}

        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="font-medium">
            Prefere usar um app próprio? Antes de começar, no Meta Developers:
          </p>
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
              <Label htmlFor="wabaId" className="text-xs">
                ID da conta comercial do WhatsApp (opcional — a gente descobre sozinho ao ativar)
              </Label>
              <Input
                id="wabaId"
                placeholder="Ex: 987654321098765"
                value={wabaId}
                onChange={(e) => setWabaId(e.target.value)}
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
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <p className="font-medium">{settings.displayPhoneNumber ?? settings.phoneNumberId}</p>
                <p className="text-muted-foreground">Phone number ID: {settings.phoneNumberId}</p>
                {settings.wabaId ? (
                  <p className="text-muted-foreground">WABA ID: {settings.wabaId}</p>
                ) : null}
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
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-sm font-medium">Recebimento de mensagens não ativado?</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Se o webhook está configurado mas mensagens reais não chegam, o app pode não estar
                inscrito na sua conta do WhatsApp. Clica aqui — a gente descobre e ativa automaticamente,
                sem precisar preencher nada.
              </p>
              <Button size="sm" className="mt-2" disabled={subscribing} onClick={handleSubscribe}>
                {subscribing ? "Ativando..." : "Ativar recebimento de mensagens"}
              </Button>
            </div>
          </div>
        )}
      </Body>
    </Frame>
  );
}
