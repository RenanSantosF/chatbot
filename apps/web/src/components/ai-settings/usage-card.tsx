"use client";

import { Gauge } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/components/session-provider";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

interface LimiteDaIa {
  podeResponder: boolean;
  usadas: number;
  limite: number;
  extras: number;
  renovaDia: number;
  renovaEm: string;
}

/** "15/10" — a data da próxima renovação, curta. */
function diaEMes(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/**
 * Quantas respostas automáticas já saíram este mês.
 *
 * Existe porque, quando o limite bate, a IA some sem aviso nenhum na tela
 * de configurações — o único sinal era a conversa chegando pra equipe com
 * a nota "atingiu o limite" (ver ai-engine.service.ts). Isso é tarde
 * demais pra quem administra: o momento certo de saber "estamos perto do
 * teto" é antes de um cliente esperar resposta e não vir nenhuma.
 */
export function UsageCard() {
  const { user } = useSession();
  const dono = user.role === "OWNER";
  const [uso, setUso] = useState<LimiteDaIa | null>(null);
  const [comprando, setComprando] = useState(false);

  useEffect(() => {
    apiFetch<LimiteDaIa>("/ai/settings/uso")
      .then(setUso)
      .catch(() => setUso(null));

    // O Stripe volta pra cá depois do Checkout do pacote extra, com o
    // resultado na URL — mesmo padrão do SubscriptionCard.
    const parametros = new URLSearchParams(window.location.search);
    const resultado = parametros.get("pacoteExtra");
    if (resultado === "sucesso") {
      toast.success("Pacote extra de 1.000 respostas creditado.");
    } else if (resultado === "cancelado") {
      toast("Compra do pacote extra não concluída — nada foi cobrado.");
    }
    if (resultado) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function comprarPacoteExtra() {
    setComprando(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/billing/checkout-extra", { method: "POST" });
      window.location.href = url;
    } catch (erro) {
      toast.error(erro instanceof ApiError ? erro.message : "Não deu pra abrir o pagamento.");
      setComprando(false);
    }
  }

  if (!uso) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
      </Card>
    );
  }

  const percentual = uso.limite > 0 ? Math.min(100, (uso.usadas / uso.limite) * 100) : 0;
  const perto = percentual >= 90;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4" />
          Respostas automáticas este mês
        </CardTitle>
        <CardDescription>
          {uso.podeResponder
            ? `Renova todo dia ${uso.renovaDia}, o dia da assinatura — a próxima em ${diaEMes(uso.renovaEm)}.`
            : `Limite atingido — a IA para de responder sozinha até comprar um pacote extra ou o plano renovar, em ${diaEMes(uso.renovaEm)}. O atendimento continua chegando normalmente pra equipe.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-semibold tabular-nums">
            {uso.usadas.toLocaleString("pt-BR")}
          </span>
          <span className="text-sm text-muted-foreground">
            de {uso.limite.toLocaleString("pt-BR")} incluídas
            {uso.extras > 0 ? ` (${uso.extras.toLocaleString("pt-BR")} de pacote extra)` : ""}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              perto ? "bg-destructive" : "bg-primary"
            }`}
            style={{ width: `${percentual}%` }}
          />
        </div>
        {/* Sempre à mão pro dono, e não só quando o limite aperta: quem
            prevê um mês cheio (campanha, fim de ano) compra antes de a IA
            parar. Pra quem não é dono o botão só daria erro de permissão —
            no lugar dele vai o recado de a quem pedir. */}
        {dono ? (
          <Button
            size="sm"
            variant={perto ? "default" : "outline"}
            disabled={comprando}
            onClick={() => void comprarPacoteExtra()}
            className="self-start"
          >
            {comprando ? <Spinner className="size-3.5" /> : null}
            Comprar 1.000 respostas extras
          </Button>
        ) : perto ? (
          <p className="text-xs text-muted-foreground">
            Pra comprar mais respostas, peça ao dono da conta.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
