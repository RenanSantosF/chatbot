"use client";

import { CreditCard } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

interface StatusDaAssinatura {
  assinaturaAtiva: boolean;
  planLabel: string;
}

/**
 * Assinar ou gerenciar, sem nada de pagamento acontecendo aqui dentro.
 *
 * Os dois botões só abrem uma sessão do Stripe (Checkout pra assinar,
 * Portal pra trocar cartão/cancelar) e mandam a pessoa pra lá — cartão,
 * fatura e cancelamento são responsabilidade do Stripe, não deste painel.
 */
export function SubscriptionCard() {
  const [status, setStatus] = useState<StatusDaAssinatura | null>(null);
  const [indo, setIndo] = useState(false);

  useEffect(() => {
    apiFetch<StatusDaAssinatura>("/billing/status")
      .then(setStatus)
      .catch(() => setStatus(null));

    // O Stripe volta pra cá depois do Checkout, com o resultado na URL.
    const parametros = new URLSearchParams(window.location.search);
    const resultado = parametros.get("assinatura");
    if (resultado === "sucesso") {
      toast.success("Assinatura confirmada.");
    } else if (resultado === "cancelada") {
      toast("Assinatura não concluída — nada foi cobrado.");
    }
    if (resultado) {
      // Limpa o parâmetro pra um F5 não repetir o aviso.
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function assinar() {
    setIndo(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/billing/checkout", { method: "POST" });
      window.location.href = url;
    } catch (erro) {
      toast.error(erro instanceof ApiError ? erro.message : "Não deu pra abrir o pagamento.");
      setIndo(false);
    }
  }

  async function gerenciar() {
    setIndo(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/billing/portal", { method: "POST" });
      window.location.href = url;
    } catch (erro) {
      toast.error(erro instanceof ApiError ? erro.message : "Não deu pra abrir a gestão da assinatura.");
      setIndo(false);
    }
  }

  if (!status) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-4" />
          Assinatura
        </CardTitle>
        <CardDescription>
          {status.assinaturaAtiva ? `Plano: ${status.planLabel}.` : "Sem assinatura ativa."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button size="sm" disabled={indo} onClick={() => void (status.assinaturaAtiva ? gerenciar() : assinar())}>
          {indo ? <Spinner className="size-3.5" /> : null}
          {status.assinaturaAtiva ? "Gerenciar assinatura" : "Assinar agora"}
        </Button>
      </CardContent>
    </Card>
  );
}
