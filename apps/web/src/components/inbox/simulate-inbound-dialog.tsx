"use client";

import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

/**
 * Ferramenta de teste: manda uma mensagem "como se fosse" um cliente
 * chegando por um canal externo, sem precisar de um WhatsApp real. Não é
 * feature de produto, é o jeito de testar o inbox e a IA rapidamente — por
 * isso vira um painel lateral acionado por um ícone discreto, em vez de
 * ocupar espaço fixo na coluna de conversas.
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

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Simular mensagem de cliente"
            title="Simular mensagem de cliente"
          >
            <MessageSquarePlus className="size-4" />
          </Button>
        }
      />
      <SheetContent className="gap-0">
        <SheetHeader>
          <SheetTitle>Simular cliente</SheetTitle>
          <SheetDescription>
            Cria uma mensagem como se tivesse chegado de fora, pra testar o atendimento sem
            depender do WhatsApp.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sim-phone">Telefone</Label>
            <Input
              id="sim-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sim-name">Nome</Label>
            <Input id="sim-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sim-content">Mensagem</Label>
            <Input
              id="sim-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <SheetFooter className="px-0">
            <Button type="submit" disabled={loading}>
              {loading ? "Enviando..." : "Enviar"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
