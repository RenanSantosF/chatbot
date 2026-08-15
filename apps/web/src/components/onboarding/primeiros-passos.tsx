"use client";

import { ArrowRight, Check, Rocket } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface PassoDeAtivacao {
  chave: string;
  titulo: string;
  descricao: string;
  destino: string;
  feito: boolean;
}

/**
 * O que falta pra empresa estar de fato atendendo.
 *
 * Escolhi isto no lugar de um tour guiado, e a razão é de negócio. Tour é
 * assistido uma vez, no minuto em que a pessoa menos entende o produto, e
 * depois some — ela fecha, some a informação, e ninguém volta pra revê-lo.
 * Uma conta que criou cadastro e não conectou o WhatsApp não viu valor
 * nenhum, e não vira cliente pagante; é esse buraco que precisa de ajuda,
 * não a descrição dos menus.
 *
 * A lista fica visível enquanto houver pendência, some sozinha quando tudo
 * estiver feito, e cada item leva direto pra tela que resolve. É lembrete,
 * não aula.
 *
 * O estado vem CALCULADO do servidor, do estado real do sistema — nunca de
 * "já cliquei aqui". Se o WhatsApp for desconectado depois, o passo volta a
 * ficar pendente, porque é a verdade.
 */
export function PrimeirosPassos({
  passos,
  concluidos,
}: {
  passos: PassoDeAtivacao[];
  concluidos: number;
}) {
  // Tudo pronto: a lista cumpriu o papel e sai da frente. Um card
  // permanente dizendo "parabéns" vira móvel na tela principal.
  if (passos.length === 0 || concluidos === passos.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="size-4" />
          Primeiros passos
          <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
            {concluidos} de {passos.length}
          </span>
        </CardTitle>
        <CardDescription>
          O caminho mais curto até a primeira conversa real chegando aqui.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {passos.map((passo) => (
          <Link
            key={passo.chave}
            href={passo.destino}
            aria-disabled={passo.feito}
            className={cn(
              "flex items-center gap-3 rounded-lg border p-3 transition-colors",
              passo.feito ? "opacity-60" : "hover:bg-accent",
            )}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border",
                passo.feito
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-dashed text-muted-foreground",
              )}
            >
              {passo.feito ? <Check className="size-3.5" /> : null}
            </span>

            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block text-sm font-medium",
                  passo.feito && "line-through decoration-1",
                )}
              >
                {passo.titulo}
              </span>
              <span className="block text-xs text-muted-foreground text-pretty">
                {passo.descricao}
              </span>
            </span>

            {passo.feito ? null : (
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            )}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
