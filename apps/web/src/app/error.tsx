"use client";

import { useEffect } from "react";
import { ServerCrash } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Tela de erro do app inteiro (inclusive do layout do painel).
 *
 * Sem ela, qualquer falha no servidor — quase sempre a API fora do ar por
 * um instante, num deploy ou reinício — caía no "This page couldn't load"
 * genérico do Next, em inglês e sem dizer o que fazer. Aqui a pessoa
 * entende que é passageiro e tem um botão pra tentar de novo sem perder a
 * URL em que estava.
 */
export default function ErroDoApp({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ServerCrash className="size-6" />
      </div>
      <div className="space-y-1">
        <h1 className="text-base font-semibold">O servidor não respondeu</h1>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground text-pretty">
          Normalmente é passageiro — o sistema pode estar reiniciando. Espere alguns segundos e
          tente de novo.
        </p>
      </div>
      <Button onClick={() => retry()}>Tentar de novo</Button>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">Código: {error.digest}</p>
      ) : null}
    </div>
  );
}
