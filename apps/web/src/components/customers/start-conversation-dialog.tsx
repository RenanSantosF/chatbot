"use client";

import { MessageSquarePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/ui/select-field";
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

interface Template {
  name: string;
  language: string;
  body: string;
  placeholders: number;
}

/**
 * Iniciar conversa só existe via template aprovado. Não é escolha de
 * design: fora da janela de 24 horas desde a última mensagem do cliente, a
 * Meta recusa texto livre. Como quem nunca escreveu nunca abriu janela
 * nenhuma, template é o único caminho — e a tela diz isso em vez de deixar
 * a pessoa descobrir com um erro.
 */
export function StartConversationDialog({
  customer,
  onStarted,
}: {
  customer: { id: string; name: string; phone: string } | null;
  onStarted: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [erroTemplates, setErroTemplates] = useState<string | null>(null);
  const [chosen, setChosen] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open || templates) return;
    apiFetch<Template[]>("/conversations/templates")
      .then((list) => {
        setTemplates(list);
        setChosen(list[0] ? `${list[0].name}|${list[0].language}` : "");
      })
      .catch((error) =>
        setErroTemplates(
          error instanceof ApiError ? error.message : "Não deu pra carregar os templates.",
        ),
      );
  }, [open, templates]);

  const template = templates?.find((item) => `${item.name}|${item.language}` === chosen);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!template || !customer) return;
    setSending(true);
    try {
      const { conversationId } = await apiFetch<{ conversationId: string }>(
        "/conversations/start",
        {
          method: "POST",
          body: JSON.stringify({
            phone: customer.phone,
            name: customer.name,
            templateName: template.name,
            templateLanguage: template.language,
            bodyParams: params.slice(0, template.placeholders),
          }),
        },
      );
      toast.success("Conversa iniciada.");
      setOpen(false);
      setParams([]);
      onStarted(conversationId);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Não deu pra iniciar a conversa.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button size="sm" variant="outline" disabled={!customer}>
            <MessageSquarePlus className="size-4" />
            Iniciar conversa
          </Button>
        }
      />
      <SheetContent className="gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Nova conversa</SheetTitle>
          <SheetDescription>
            O WhatsApp não deixa mandar mensagem livre pra quem não escreveu nas últimas 24
            horas — só um modelo aprovado antes pela Meta. Escolha qual usar. Assim que a pessoa
            responder, a conversa segue normal.
          </SheetDescription>
        </SheetHeader>

        {erroTemplates ? (
          <p className="px-4 py-6 text-sm text-destructive">{erroTemplates}</p>
        ) : !templates ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Carregando templates...</p>
        ) : templates.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Nenhum template aprovado nesta conta. Crie um no Gerenciador do WhatsApp e volte aqui
            quando a Meta aprovar.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-4 py-2">
            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              Para <strong>{customer?.name}</strong> · {customer?.phone}
            </p>

            <SelectField
              label="Template"
              value={chosen}
              onChange={(next) => {
                setChosen(next);
                setParams([]);
              }}
              options={templates.map((item) => ({
                value: `${item.name}|${item.language}`,
                label: `${item.name} (${item.language})`,
              }))}
            />

            {template ? (
              <p className="rounded-md bg-muted p-2.5 text-xs leading-relaxed whitespace-pre-wrap">
                {template.body}
              </p>
            ) : null}

            {Array.from({ length: template?.placeholders ?? 0 }).map((_, index) => (
              <div key={index} className="flex flex-col gap-1.5">
                <Label htmlFor={`param-${index}`}>{`Valor de {{${index + 1}}}`}</Label>
                <Input
                  id={`param-${index}`}
                  value={params[index] ?? ""}
                  onChange={(event) =>
                    setParams((prev) => {
                      const next = [...prev];
                      next[index] = event.target.value;
                      return next;
                    })
                  }
                  required
                />
              </div>
            ))}

            <SheetFooter className="px-0">
              <Button type="submit" disabled={sending || !template}>
                {sending ? "Enviando..." : "Iniciar conversa"}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
