"use client";

import { MessageSquarePlus, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
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
import type { ConversationDetail } from "@/lib/types";

/**
 * Puxar conversa com quem ainda não escreveu.
 *
 * Isto aqui exigia escolher um modelo aprovado pela Meta, e a explicação
 * na tela dizia que o WhatsApp não deixa mandar texto livre fora da
 * janela de 24 horas. Era verdade — do canal oficial. No canal por QR
 * code não existe janela nenhuma: o aparelho manda uma mensagem comum,
 * igual a qualquer pessoa mandando pelo celular.
 *
 * Como a empresa conecta por QR code, a tela que existia era uma porta
 * trancada: ela pedia um modelo que essa conta nunca teria.
 *
 * Serve pros dois casos. Com `customer`, é o botão de mensagem do
 * contato. Sem ele, é a conversa nova pra um número que ainda não é
 * cliente — e aí o telefone também é digitado aqui.
 */
export function StartConversationDialog({
  customer,
  onStarted,
  gatilho,
}: {
  customer?: { id: string; name: string; phone: string } | null;
  onStarted: (id: string) => void;
  /** Troca o botão que abre o painel, quando ele não é o padrão. */
  gatilho?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);

  // Com contato escolhido, o telefone é o dele e não se digita nada.
  const paraNumeroNovo = !customer;
  const destino = customer?.phone ?? phone;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (sending || !content.trim() || !destino.trim()) return;

    setSending(true);
    try {
      const conversa = await apiFetch<ConversationDetail>("/conversations/iniciar", {
        method: "POST",
        body: JSON.stringify({
          phone: destino,
          name: customer?.name ?? name.trim() ?? undefined,
          content: content.trim(),
        }),
      });
      toast.success("Mensagem enviada.");
      setOpen(false);
      setContent("");
      setPhone("");
      setName("");
      onStarted(conversa.id);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Não deu pra enviar a mensagem.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          gatilho ?? (
            <Button size="sm" variant="outline">
              <MessageSquarePlus className="size-4" />
              Mensagem
            </Button>
          )
        }
      />
      <SheetContent className="gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{paraNumeroNovo ? "Nova conversa" : "Mandar mensagem"}</SheetTitle>
          <SheetDescription>
            {paraNumeroNovo
              ? "Escreva pra um número que ainda não está no painel. Ele vira cliente assim que a mensagem sai, e a conversa aparece no Inbox."
              : "A conversa abre no Inbox já com esta mensagem enviada, atribuída a você."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-4 py-2">
          {paraNumeroNovo ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nova-conversa-telefone">Telefone</Label>
                <Input
                  id="nova-conversa-telefone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="5527999998888"
                  inputMode="tel"
                  autoComplete="off"
                />
                <span className="text-xs text-muted-foreground">
                  Com DDI e DDD. Pode digitar com parênteses e traço — a gente limpa.
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nova-conversa-nome">Nome (opcional)</Label>
                <Input
                  id="nova-conversa-nome"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Como essa pessoa aparece no painel"
                  autoComplete="off"
                />
              </div>
            </>
          ) : (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              Para <strong>{customer.name}</strong> · {customer.phone}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nova-conversa-texto">Mensagem</Label>
            <Textarea
              id="nova-conversa-texto"
              rows={5}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Escreva a primeira mensagem..."
              maxLength={4000}
            />
          </div>

          <SheetFooter className="px-0">
            <Button
              type="submit"
              disabled={sending || !content.trim() || !destino.trim()}
            >
              {sending ? <Spinner /> : <Send className="size-4" />}
              Enviar
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
