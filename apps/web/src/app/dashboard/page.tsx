"use client";

import { Bot, Clock, MessagesSquare, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart } from "@/components/charts/bar-chart";
import { DateRangePicker, rangeForDays, type DateRange } from "@/components/charts/date-range-picker";
import { LineChart } from "@/components/charts/line-chart";
import { StatTile } from "@/components/charts/stat-tile";
import { PageHeader } from "@/components/page-header";
import { BoasVindas } from "@/components/onboarding/boas-vindas";
import {
  PrimeirosPassos,
  type PassoDeAtivacao,
} from "@/components/onboarding/primeiros-passos";
import { useSession } from "@/components/session-provider";
import { apiFetch } from "@/lib/api-client";
import type { ConversationStatus, MetricsOverview } from "@/lib/types";

const STATUS_LABEL: Record<ConversationStatus, string> = {
  OPEN: "Aberta",
  WAITING_CUSTOMER: "Aguard. cliente",
  WAITING_AGENT: "Aguard. atendente",
  RESOLVED: "Resolvida",
  CLOSED: "Fechada",
};

/** Segundos viram algo que se lê de relance: "1m 20s", "2h 5m". */
function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function shortDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

interface Ativacao {
  passos: PassoDeAtivacao[];
  concluidos: number;
  total: number;
  precisaDeBoasVindas: boolean;
}

export default function DashboardOverviewPage() {
  const { user } = useSession();
  const [ativacao, setAtivacao] = useState<Ativacao | null>(null);
  const [range, setRange] = useState<DateRange>(() => rangeForDays(30));
  const [metrics, setMetrics] = useState<MetricsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    apiFetch<MetricsOverview>(`/metrics?from=${range.from}&to=${range.to}`)
      .then((result) => {
        if (active) setMetrics(result);
      })
      .catch(() => toast.error("Não deu pra carregar os indicadores."))
      .finally(() => {
        if (active) setLoading(false);
      });
    // Corrida entre períodos: se o usuário troca o filtro rápido, a resposta
    // antiga não pode sobrescrever a nova.
    return () => {
      active = false;
    };
  }, [range]);

  // Buscado uma vez: o estado de ativação muda por ação da pessoa, e ela
  // volta a esta tela depois de agir — o que já recarrega o componente.
  useEffect(() => {
    apiFetch<Ativacao>("/onboarding")
      .then(setAtivacao)
      .catch(() => setAtivacao(null));
  }, []);

  const totals = metrics?.totals;
  const resolvedTotal = (totals?.resolvedByAi ?? 0) + (totals?.resolvedByHuman ?? 0);
  const aiShare = resolvedTotal > 0 ? Math.round(((totals?.resolvedByAi ?? 0) / resolvedTotal) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* A chegada vem ANTES de tudo, e no lugar do cabeçalho: quem entrou
          agora não tem indicador nenhum pra ver, e um painel de gráficos
          zerados é a pior primeira impressão possível. */}
      {ativacao?.precisaDeBoasVindas ? (
        <BoasVindas
          primeiroNome={user.name.split(" ")[0]}
          onConcluir={() =>
            setAtivacao((atual) =>
              atual ? { ...atual, precisaDeBoasVindas: false } : atual,
            )
          }
        />
      ) : (
        <PageHeader
          title="Visão geral"
          description="Como anda o atendimento no período escolhido."
          action={<DateRangePicker value={range} onChange={setRange} />}
        />
      )}

      {ativacao && !ativacao.precisaDeBoasVindas ? (
        <PrimeirosPassos passos={ativacao.passos} concluidos={ativacao.concluidos} />
      ) : null}

      {/* Uma coluna no celular, e não duas.
          Em 390px cada cartão sobrava com ~160px, e a linha de baixo —
          "iniciadas no período", "0 da IA · 0 da equipe" — era cortada em
          reticências. Essa linha é o que dá sentido ao número: sem ela o
          cartão vira um algarismo solto. Melhor rolar um pouco mais. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Conversas"
          value={String(totals?.conversations ?? 0)}
          hint="iniciadas no período"
          icon={MessagesSquare}
          loading={loading}
        />
        <StatTile
          label="Mensagens"
          value={String(totals?.messages ?? 0)}
          hint={`${totals?.aiMessages ?? 0} da IA · ${totals?.agentMessages ?? 0} da equipe`}
          icon={Users}
          loading={loading}
        />
        <StatTile
          label="Tempo de resposta"
          value={duration(metrics?.responseTime.overallSeconds ?? null)}
          hint={`IA ${duration(metrics?.responseTime.aiSeconds ?? null)} · equipe ${duration(
            metrics?.responseTime.humanSeconds ?? null,
          )}`}
          icon={Clock}
          loading={loading}
        />
        <StatTile
          label="Resolvidas pela IA"
          value={resolvedTotal > 0 ? `${aiShare}%` : "—"}
          hint={`${totals?.resolvedByAi ?? 0} de ${resolvedTotal} resolvidas`}
          icon={Bot}
          loading={loading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Movimento por dia</CardTitle>
          <CardDescription>Conversas iniciadas e mensagens trocadas.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading || !metrics ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <LineChart
              valueLabel="Movimento"
              labels={metrics.byDay.map((day) => shortDay(day.day))}
              series={[
                {
                  key: "conversations",
                  label: "Conversas",
                  color: "var(--viz-series-1)",
                  points: metrics.byDay.map((day) => day.conversations),
                },
                {
                  key: "messages",
                  label: "Mensagens",
                  color: "var(--viz-series-2)",
                  points: metrics.byDay.map((day) => day.messages),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Conversas por status</CardTitle>
            <CardDescription>Onde estão as conversas do período.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading || !metrics ? (
              <Skeleton className="h-40 w-full" />
            ) : metrics.byStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma conversa no período.</p>
            ) : (
              <BarChart
                valueLabel="Conversas"
                data={metrics.byStatus.map((entry) => ({
                  label: STATUS_LABEL[entry.status],
                  value: entry.count,
                }))}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quem respondeu</CardTitle>
            <CardDescription>Perguntas de cliente que receberam resposta.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading || !metrics ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <div className="flex flex-col gap-4">
                <div className="space-y-1">
                  <p className="font-heading text-3xl leading-none font-semibold tabular-nums">
                    {metrics.responseTime.answered}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    respondidas · {metrics.responseTime.unanswered} ainda sem resposta
                  </p>
                </div>
                <BarChart
                  valueLabel="Mensagens enviadas"
                  data={[
                    { label: "IA", value: metrics.totals.aiMessages },
                    { label: "Equipe", value: metrics.totals.agentMessages },
                  ]}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
