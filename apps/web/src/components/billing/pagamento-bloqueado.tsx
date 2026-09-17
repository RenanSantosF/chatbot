"use client";

import { CreditCard, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Marca } from "@/components/marca";
import { apiFetch } from "@/lib/api-client";
import type { EstadoDaCobranca, MeResponse, SessionUser } from "@/lib/types";

const TENTATIVAS_DE_CONFIRMACAO = 8;
const INTERVALO_MS = 2000;

/**
 * A tela inteira, no lugar do painel, pra quem está bloqueado.
 *
 * Substitui o DashboardShell por completo (ver dashboard/layout.tsx) em
 * vez de deixar cada chamada de API estourar 403 uma por uma — o
 * BillingGuard do lado do servidor é a rede de segurança, esta tela é a
 * experiência de verdade.
 *
 * Um detalhe cuida da corrida entre o Checkout do Stripe terminar e o
 * webhook confirmar: quem volta do pagamento com sucesso na URL vê
 * "confirmando" por alguns segundos, reconsultando a sessão, em vez de
 * cair direto de novo nesta mesma tela de bloqueio por pura demora do
 * webhook — o que pareceria "paguei e continua bloqueado".
 */
export function PagamentoBloqueado({
  user,
  cobranca,
}: {
  user: SessionUser;
  cobranca: EstadoDaCobranca;
}) {
  const router = useRouter();
  // Leitura direta da URL, e não `useSearchParams()`: evita exigir um
  // Suspense boundary só pra este caso raro (mesmo padrão do
  // SubscriptionCard).
  const [vindoDoCheckout] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("assinatura") === "sucesso",
  );
  const [confirmando, setConfirmando] = useState(vindoDoCheckout);
  const [indo, setIndo] = useState(false);

  useEffect(() => {
    if (!vindoDoCheckout) return;

    let tentativas = 0;
    const timer = setInterval(() => {
      tentativas += 1;
      apiFetch<MeResponse>("/auth/me")
        .then((sessao) => {
          if (!sessao.cobranca.bloqueado) {
            clearInterval(timer);
            window.history.replaceState(null, "", window.location.pathname);
            router.refresh();
            return;
          }
          if (tentativas >= TENTATIVAS_DE_CONFIRMACAO) {
            clearInterval(timer);
            setConfirmando(false);
          }
        })
        .catch(() => {
          if (tentativas >= TENTATIVAS_DE_CONFIRMACAO) {
            clearInterval(timer);
            setConfirmando(false);
          }
        });
    }, INTERVALO_MS);

    return () => clearInterval(timer);
  }, [vindoDoCheckout, router]);

  async function assinar() {
    setIndo(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/billing/checkout", { method: "POST" });
      window.location.href = url;
    } catch {
      setIndo(false);
    }
  }

  async function sair() {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
    router.refresh();
  }

  const jaAssinouAntes = cobranca.vencidoDesde !== null;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
      <Marca className="size-10" />
      {confirmando ? (
        <>
          <Spinner className="size-6" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Confirmando seu pagamento — isso leva só alguns segundos.
          </p>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-lg font-semibold">
              {jaAssinouAntes ? "Assinatura vencida" : "Assinatura necessária"}
            </h1>
            <p className="max-w-sm text-sm text-muted-foreground text-pretty">
              {user.role === "OWNER"
                ? jaAssinouAntes
                  ? "O prazo de carência acabou e o acesso foi bloqueado. Regularize o pagamento para voltar a usar o sistema."
                  : "Esta conta ainda não tem uma assinatura ativa. Assine para começar a usar o sistema."
                : jaAssinouAntes
                  ? "A assinatura desta empresa venceu e o acesso foi bloqueado. Peça para o dono da conta regularizar o pagamento."
                  : "Esta conta ainda não tem uma assinatura ativa. Peça para o dono da conta assinar."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {user.role === "OWNER" ? (
              <Button disabled={indo} onClick={() => void assinar()}>
                {indo ? <Spinner className="size-3.5" /> : <CreditCard className="size-4" />}
                Assinar agora
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => void sair()}>
              <LogOut className="size-4" />
              Sair
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
