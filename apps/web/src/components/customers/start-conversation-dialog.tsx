"use client";

import { ArrowLeft, MessageSquarePlus, Search, Send, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import type { ConversationDetail, Customer } from "@/lib/types";

/** Quem vai receber a mensagem — da lista, ou digitado na hora. */
interface Destino {
  name: string;
  phone: string;
}

function iniciais(nome: string) {
  return nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join("");
}

/**
 * Puxar conversa com quem ainda não escreveu.
 *
 * A primeira versão pedia um modelo aprovado pela Meta — regra do canal
 * oficial, onde texto livre é recusado fora da janela de 24 horas. Numa
 * conta conectada por QR code aquilo era uma porta trancada: pedia um
 * modelo que a conta nunca teria.
 *
 * A segunda pedia o telefone digitado. Funcionava, e ainda assim era o
 * caminho errado pro caso comum: quem quer falar com alguém quase sempre
 * já tem essa pessoa na agenda — obrigar a digitar um número que o
 * sistema já conhece é fazer o operador trabalhar pelo sistema.
 *
 * Agora abre na LISTA, como o WhatsApp Web: procura, escolhe, escreve.
 * Digitar o número continua possível, um toque adiante, pra quem a
 * empresa acabou de anotar num papel.
 */
export function StartConversationDialog({
  customer,
  onStarted,
  gatilho,
}: {
  /** Quando já se sabe com quem falar, a lista não faz sentido: vai direto. */
  customer?: { id: string; name: string; phone: string } | null;
  onStarted: (id: string) => void;
  /** Troca o botão que abre o painel, quando ele não é o padrão. */
  gatilho?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [destino, setDestino] = useState<Destino | null>(null);
  const [digitandoNumero, setDigitandoNumero] = useState(false);

  const [contatos, setContatos] = useState<Customer[] | null>(null);
  const [busca, setBusca] = useState("");

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);

  const carregar = useCallback((termo: string) => {
    const q = termo.trim();
    apiFetch<Customer[]>(
      q ? `/customers?search=${encodeURIComponent(q)}` : "/customers",
    )
      .then(setContatos)
      .catch(() => setContatos([]));
  }, []);

  // Só busca com o painel aberto: a lista de contatos não interessa a
  // quem está atendendo, e carregá-la à toa custa uma consulta por tela.
  useEffect(() => {
    if (!open || customer) return;
    const timer = setTimeout(() => carregar(busca), busca ? 250 : 0);
    return () => clearTimeout(timer);
  }, [open, busca, carregar, customer]);

  function reiniciar() {
    setDestino(null);
    setDigitandoNumero(false);
    setBusca("");
    setPhone("");
    setName("");
    setContent("");
  }

  function abrirMudou(aberto: boolean) {
    setOpen(aberto);
    if (!aberto) reiniciar();
    // Com contato definido de fora, não há o que escolher.
    else if (customer) setDestino(customer);
  }

  function confirmarNumero(event: React.FormEvent) {
    event.preventDefault();
    const limpo = phone.replace(/\D/g, "");
    if (limpo.length < 12) {
      toast.error("Informe o telefone com DDI e DDD, por exemplo 5527999998888.");
      return;
    }
    setDestino({ name: name.trim() || limpo, phone: limpo });
  }

  async function enviar(event: React.FormEvent) {
    event.preventDefault();
    if (sending || !destino || !content.trim()) return;

    setSending(true);
    try {
      const conversa = await apiFetch<ConversationDetail>("/conversations/iniciar", {
        method: "POST",
        body: JSON.stringify({
          phone: destino.phone,
          name: destino.name,
          content: content.trim(),
        }),
      });
      toast.success("Mensagem enviada.");
      setOpen(false);
      reiniciar();
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
    <Sheet open={open} onOpenChange={abrirMudou}>
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
      <SheetContent className="flex flex-col gap-0 overflow-hidden p-0">
        <SheetHeader className="shrink-0">
          <div className="flex items-center gap-2">
            {/* Voltar só existe quando há pra onde: com contato vindo de
                fora, esta é a única etapa. */}
            {destino && !customer ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Voltar"
                onClick={() => {
                  setDestino(null);
                  setDigitandoNumero(false);
                }}
              >
                <ArrowLeft className="size-4" />
              </Button>
            ) : null}
            <div className="min-w-0">
              <SheetTitle>
                {destino ? destino.name : digitandoNumero ? "Novo contato" : "Nova conversa"}
              </SheetTitle>
              <SheetDescription>
                {destino
                  ? destino.phone
                  : digitandoNumero
                    ? "Pra um número que ainda não está na lista."
                    : "Escolha com quem falar."}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* ETAPA 3 — escrever. */}
        {destino ? (
          <form onSubmit={enviar} className="flex flex-col gap-4 px-4 py-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nova-conversa-texto">Mensagem</Label>
              <Textarea
                id="nova-conversa-texto"
                autoFocus
                rows={5}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="Escreva a primeira mensagem..."
                maxLength={4000}
              />
            </div>
            <SheetFooter className="px-0">
              <Button type="submit" disabled={sending || !content.trim()}>
                {sending ? <Spinner /> : <Send className="size-4" />}
                Enviar
              </Button>
            </SheetFooter>
          </form>
        ) : digitandoNumero ? (
          /* ETAPA 2 — o número que não está na lista. */
          <form onSubmit={confirmarNumero} className="flex flex-col gap-4 px-4 py-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nova-conversa-telefone">Telefone</Label>
              <Input
                id="nova-conversa-telefone"
                autoFocus
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="5527999998888"
                inputMode="tel"
                autoComplete="off"
              />
              <span className="text-xs text-muted-foreground">
                Com DDI e DDD. Pode digitar com parênteses e traço.
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nova-conversa-nome">Nome (opcional)</Label>
              <Input
                id="nova-conversa-nome"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Como aparece no painel"
                autoComplete="off"
              />
            </div>
            <SheetFooter className="px-0">
              <Button type="submit" disabled={!phone.trim()}>
                Continuar
              </Button>
            </SheetFooter>
          </form>
        ) : (
          /* ETAPA 1 — a lista, que é o caminho comum. */
          <>
            <div className="flex shrink-0 flex-col gap-2 px-4 pt-1 pb-2">
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={busca}
                  onChange={(event) => setBusca(event.target.value)}
                  placeholder="Buscar nome ou telefone"
                  className="pl-8"
                />
              </div>

              <button
                type="button"
                onClick={() => setDigitandoNumero(true)}
                className="flex items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <UserPlus className="size-4.5" />
                </span>
                <span className="text-sm font-medium">Novo contato</span>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {!contatos ? (
                <div className="flex flex-col gap-2 px-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : contatos.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground text-pretty">
                  {busca.trim()
                    ? `Ninguém com “${busca.trim()}”. Use “Novo contato” pra escrever pra um número novo.`
                    : "Nenhum contato ainda. Eles aparecem sozinhos quando alguém escreve, ou quando o WhatsApp traz a agenda do aparelho."}
                </p>
              ) : (
                contatos.map((contato) => (
                  <button
                    key={contato.id}
                    type="button"
                    onClick={() =>
                      setDestino({ name: contato.name, phone: contato.phone })
                    }
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <Avatar className="size-9 shrink-0">
                      <AvatarFallback className="text-xs">
                        {iniciais(contato.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {contato.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground tabular-nums">
                        {contato.phone}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
