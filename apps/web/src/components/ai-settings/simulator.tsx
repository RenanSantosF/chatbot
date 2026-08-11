"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

export function Simulator() {
  const [message, setMessage] = useState("Qual o horário de vocês?");
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setLoading(true);
    setError(null);
    setReply(null);
    try {
      const result = await apiFetch<{ reply: string }>("/ai/simulate", {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      setReply(result.reply);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não deu pra testar agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Testar a IA</CardTitle>
        <CardDescription>
          Digite uma mensagem como se fosse um cliente e veja como a IA responde com as configurações atuais —
          sem criar conversa nem cliente de verdade.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Mensagem do cliente..." />
          <Button type="submit" disabled={loading || !message.trim()}>
            {loading ? "Testando..." : "Testar"}
          </Button>
        </form>
        {reply ? (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Resposta</p>
            <p className="whitespace-pre-wrap">{reply}</p>
          </div>
        ) : null}
        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
