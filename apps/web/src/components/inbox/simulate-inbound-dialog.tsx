"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

/**
 * Ferramenta de teste: manda uma mensagem "como se fosse" um cliente
 * chegando por um canal externo, sem precisar de um WhatsApp real. Fica
 * visualmente separada do resto do painel de propósito — não é uma feature
 * de produto, é o jeito de testar o inbox e a IA rapidamente.
 */
export function SimulateInboundDialog({ onSimulated }: { onSimulated: () => void }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("+55 11 98888-7777");
  const [name, setName] = useState("Maria Clara Souza");
  const [content, setContent] = useState("Olá, queria saber sobre aposentadoria.");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/conversations/simulate-inbound", {
        method: "POST",
        body: JSON.stringify({ customerPhone: phone, customerName: name, content }),
      });
      onSimulated();
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não deu pra simular a mensagem.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="border-dashed" onClick={() => setOpen(true)}>
        Simular cliente
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed bg-muted/40 p-3"
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="sim-phone" className="text-xs">
          Telefone
        </Label>
        <Input
          id="sim-phone"
          className="h-8 w-40"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sim-name" className="text-xs">
          Nome
        </Label>
        <Input
          id="sim-name"
          className="h-8 w-40"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sim-content" className="text-xs">
          Mensagem
        </Label>
        <Input
          id="sim-content"
          className="h-8 w-64"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
        />
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={loading}>
          Enviar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
