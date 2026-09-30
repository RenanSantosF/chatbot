"use client";

import { ArrowLeft, Check, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/components/session-provider";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";

interface Pacote {
  quantidade: number;
  /** Preço cobrado pelo Stripe, em centavos; nulo se o Stripe não respondeu. */
  centavos: number | null;
  moeda: string | null;
}

interface Uso {
  usadas: number;
  limite: number;
  extras: number;
}

const reais = (centavos: number, moeda: string | null) =>
  (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: (moeda ?? "brl").toUpperCase(),
  });

/**
 * Comprar respostas de IA extras — escolhendo o tamanho do pacote.
 *
 * Existe como rota, e não só como botão, pra poder ser apontada de
 * qualquer lugar: o aviso de limite atingido, a tela de conta, o suporte.
 * Os pacotes e os preços vêm da API (que pergunta ao Stripe), nunca de
 * um número escrito aqui.
 *
 * Só o dono compra — é quem responde pelo cartão.
 */
export default function MensagensExtrasPage() {
  const { user } = useSession();
  const dono = user.role === "OWNER";
  const [pacotes, setPacotes] = useState<Pacote[] | null>(null);
  const [uso, setUso] = useState<Uso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [comprando, setComprando] = useState<number | null>(null);

  useEffect(() => {
    if (!dono) return;
    apiFetch<Pacote[]>("/billing/pacotes")
      .then(setPacotes)
      .catch((falha) =>
        setErro(falha instanceof ApiError ? falha.message : "Não deu pra carregar os pacotes."),
      );
    apiFetch<Uso>("/ai/settings/uso")
      .then(setUso)
      .catch(() => undefined);
  }, [dono]);

  async function comprar(quantidade: number) {
    setComprando(quantidade);
    try {
      const { url } = await apiFetch<{ url: string }>("/billing/checkout-extra", {
        method: "POST",
        body: JSON.stringify({ quantidade }),
      });
      window.location.assign(url);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não deu pra abrir o pagamento agora.");
      setComprando(null);
    }
  }

  if (!dono) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-lg font-semibold">Só o dono da conta compra respostas extras</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          É quem responde pelo pagamento. Peça a ele pra abrir esta mesma página, ou ir em
          Configurações › Conta.
        </p>
        <Button variant="outline" size="sm" render={<Link href="/dashboard" />}>
          <ArrowLeft className="size-4" />
          Voltar
        </Button>
      </div>
    );
  }

  // O menor preço por resposta ganha o selo — calculado, não escolhido à mão.
  const precoPorResposta = (p: Pacote) => (p.centavos ? p.centavos / p.quantidade : Infinity);
  const maisEconomico =
    pacotes && pacotes.length > 1
      ? pacotes.reduce((melhor, p) => (precoPorResposta(p) < precoPorResposta(melhor) ? p : melhor))
          .quantidade
      : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Respostas extras de IA</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Somam às respostas do plano na hora. O que você comprar e não usar{" "}
          <strong className="font-medium text-foreground">não vence na renovação do plano</strong> —
          passa pro mês seguinte.
        </p>
      </div>

      {uso ? (
        <div className="flex flex-col gap-2 rounded-xl border p-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">Usadas neste mês</span>
            <span className="tabular-nums">
              <strong>{uso.usadas.toLocaleString("pt-BR")}</strong> de{" "}
              {uso.limite.toLocaleString("pt-BR")}
              {uso.extras > 0 ? (
                <span className="text-muted-foreground">
                  {" "}
                  (inclui {uso.extras.toLocaleString("pt-BR")} compradas)
                </span>
              ) : null}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                uso.usadas / uso.limite >= 0.9 ? "bg-amber-500" : "bg-primary",
              )}
              style={{ width: `${Math.min(100, (uso.usadas / Math.max(uso.limite, 1)) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      {erro ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {erro}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {!pacotes
          ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)
          : pacotes.map((pacote) => {
              const destaque = pacote.quantidade === maisEconomico;
              return (
                <div
                  key={pacote.quantidade}
                  className={cn(
                    "relative flex flex-col gap-4 rounded-xl border p-5 transition-colors",
                    destaque && "border-primary/50 bg-primary/[0.04]",
                  )}
                >
                  {destaque ? (
                    <span className="absolute -top-2.5 left-4 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                      <Sparkles className="size-3" />
                      Mais econômico
                    </span>
                  ) : null}
                  <div className="flex flex-col gap-0.5">
                    <span className="text-2xl font-semibold tracking-tight tabular-nums">
                      {pacote.quantidade.toLocaleString("pt-BR")}
                    </span>
                    <span className="text-sm text-muted-foreground">respostas de IA</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-lg font-semibold">
                      {pacote.centavos !== null ? reais(pacote.centavos, pacote.moeda) : "—"}
                    </span>
                    {pacote.centavos !== null ? (
                      <span className="text-xs text-muted-foreground">
                        {reais(pacote.centavos / pacote.quantidade, pacote.moeda)} por resposta
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        O valor aparece no pagamento
                      </span>
                    )}
                  </div>
                  <Button
                    className="mt-auto"
                    variant={destaque ? "default" : "outline"}
                    disabled={comprando !== null}
                    onClick={() => void comprar(pacote.quantidade)}
                  >
                    {comprando === pacote.quantidade ? <Spinner className="size-3.5" /> : null}
                    Comprar
                  </Button>
                </div>
              );
            })}
      </div>

      {pacotes && pacotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum pacote à venda no momento. Fale com o suporte.
        </p>
      ) : null}

      <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        {[
          "Pagamento único pelo Stripe — não vira assinatura.",
          "As respostas entram assim que o pagamento é confirmado.",
          "Só contam as respostas que a IA escreve; atendimento humano nunca é limitado.",
        ].map((item) => (
          <li key={item} className="flex items-center gap-1.5">
            <Check className="size-3.5 text-primary" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
