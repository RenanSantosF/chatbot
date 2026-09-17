"use client";

import { Gauge } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-client";

interface LimiteDaIa {
  podeResponder: boolean;
  usadas: number;
  limite: number;
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
  const [uso, setUso] = useState<LimiteDaIa | null>(null);

  useEffect(() => {
    apiFetch<LimiteDaIa>("/ai/settings/uso")
      .then(setUso)
      .catch(() => setUso(null));
  }, []);

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
            ? "Volta a zero no início do próximo mês."
            : "Limite atingido — a IA para de responder sozinha até o mês virar. O atendimento continua chegando normalmente pra equipe."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-semibold tabular-nums">
            {uso.usadas.toLocaleString("pt-BR")}
          </span>
          <span className="text-sm text-muted-foreground">
            de {uso.limite.toLocaleString("pt-BR")} incluídas
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
      </CardContent>
    </Card>
  );
}
