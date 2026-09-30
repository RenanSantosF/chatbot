"use client";

import { ArrowLeft, MessageSquarePlus, Search, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
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
 * Agora abre na LISTA, como o WhatsApp Web: procura, escolhe — e o chat
 * da pessoa abre na hora, vazio ou com o histórico que ela já tiver. A
 * primeira mensagem sai do compositor de sempre, que aceita arquivo,
 * áudio e figurinha; o formulário de texto que existia aqui no meio
 * deixava de fora tudo isso e escondia a foto e a conversa anterior.
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
  const [digitandoNumero, setDigitandoNumero] = useState(false);

  const [contatos, setContatos] = useState<Customer[] | null>(null);
  const [busca, setBusca] = useState("");

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  /** O telefone que está sendo aberto agora — pra mostrar o giro no lugar certo. */
  const [abrindo, setAbrindo] = useState<string | null>(null);

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
    setDigitandoNumero(false);
    setBusca("");
    setPhone("");
    setName("");
  }

  async function abrir(destino: Destino) {
    if (abrindo) return;
    setAbrindo(destino.phone);
    try {
      const conversa = await apiFetch<ConversationDetail>("/conversations/abrir", {
        method: "POST",
        body: JSON.stringify({ phone: destino.phone, name: destino.name }),
      });
      setOpen(false);
      reiniciar();
      onStarted(conversa.id);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Não deu pra abrir a conversa.",
      );
    } finally {
      setAbrindo(null);
    }
  }

  function confirmarNumero(event: React.FormEvent) {
    event.preventDefault();
    const limpo = phone.replace(/\D/g, "");
    if (limpo.length < 12) {
      toast.error("Informe o telefone com DDI e DDD, por exemplo 5527999998888.");
      return;
    }
    void abrir({ name: name.trim() || limpo, phone: limpo });
  }

  // Com o contato já escolhido de fora (a ficha do cliente), não há o que
  // escolher: o botão abre o chat direto, sem painel no meio.
  if (customer) {
    const botao = gatilho ?? (
      <Button size="sm" variant="outline">
        <MessageSquarePlus className="size-4" />
        Mensagem
      </Button>
    );
    return (
      <span
        className="contents"
        onClickCapture={(event) => {
          event.preventDefault();
          void abrir({ name: customer.name, phone: customer.phone });
        }}
      >
        {abrindo ? (
          <Button size="sm" variant="outline" disabled>
            <Spinner className="size-3.5" />
            Abrindo…
          </Button>
        ) : (
          botao
        )}
      </span>
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(aberto) => {
        setOpen(aberto);
        if (!aberto) reiniciar();
      }}
    >
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
            {digitandoNumero ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Voltar"
                onClick={() => setDigitandoNumero(false)}
              >
                <ArrowLeft className="size-4" />
              </Button>
            ) : null}
            <div className="min-w-0">
              <SheetTitle>{digitandoNumero ? "Novo contato" : "Nova conversa"}</SheetTitle>
              <SheetDescription>
                {digitandoNumero
                  ? "Pra um número que ainda não está na lista."
                  : "Escolha com quem falar — o chat abre na hora."}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {digitandoNumero ? (
          /* O número que não está na lista. */
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
              <Button type="submit" disabled={!phone.trim() || abrindo !== null}>
                {abrindo ? <Spinner /> : null}
                Abrir conversa
              </Button>
            </SheetFooter>
          </form>
        ) : (
          /* A lista, que é o caminho comum. */
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
                    disabled={abrindo !== null}
                    onClick={() => void abrir({ name: contato.name, phone: contato.phone })}
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
                    {abrindo === contato.phone ? <Spinner className="size-4" /> : null}
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
