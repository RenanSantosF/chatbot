"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/components/session-provider";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

/**
 * Comprar respostas de IA extras — um endereço só pra isso.
 *
 * Abre direto o pagamento do pacote (1.000 respostas). Existe como rota,
 * e não só como botão, pra poder ser apontada de qualquer lugar: o aviso
 * de limite atingido, a tela de assinatura, uma mensagem do suporte.
 *
 * Só o dono da conta compra — é quem responde pelo cartão. Quem não é
 * dono vê o porquê, em vez de um erro de permissão cru.
 */
export default function MensagensExtrasPage() {
  const { user } = useSession();
  const dono = user.role === "OWNER";
  const [erro, setErro] = useState<string | null>(null);
  const pedido = useRef(false);

  useEffect(() => {
    // Uma vez só: em modo de desenvolvimento o efeito roda duas vezes, e
    // duas sessões de pagamento abertas confundem quem está pagando.
    if (!dono || pedido.current) return;
    pedido.current = true;
    apiFetch<{ url: string }>("/billing/checkout-extra", { method: "POST" })
      .then(({ url }) => {
        window.location.href = url;
      })
      .catch((falha) =>
        setErro(falha instanceof ApiError ? falha.message : "Não deu pra abrir o pagamento agora."),
      );
  }, [dono]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      {!dono ? (
        <>
          <h1 className="text-lg font-semibold">Só o dono da conta compra respostas extras</h1>
          <p className="text-sm text-muted-foreground text-pretty">
            É quem responde pelo pagamento. Peça a ele pra abrir esta mesma página, ou ir em
            Configurações › IA.
          </p>
        </>
      ) : erro ? (
        <>
          <h1 className="text-lg font-semibold">Não deu pra abrir o pagamento</h1>
          <p className="text-sm text-muted-foreground text-pretty">{erro}</p>
        </>
      ) : (
        <>
          <Spinner className="size-6" />
          <p className="text-sm text-muted-foreground">
            Abrindo o pagamento de 1.000 respostas extras…
          </p>
        </>
      )}
      {!dono || erro ? (
        <Button variant="outline" size="sm" render={<Link href="/dashboard/settings/ai" />}>
          <ArrowLeft className="size-4" />
          Voltar
        </Button>
      ) : null}
    </div>
  );
}
