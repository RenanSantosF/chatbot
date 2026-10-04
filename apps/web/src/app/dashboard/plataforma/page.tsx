"use client";

import {
  AlertTriangle,
  Banknote,
  Check,
  ChevronDown,
  CreditCard,
  Globe,
  MessageSquare,
  Package,
  Search,
  Settings2,
  Smartphone,
  Sparkles,
  UserMinus,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  History,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BarChart } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";
import { StatTile } from "@/components/charts/stat-tile";
import { PageHeader } from "@/components/page-header";
import { GerenciarConta } from "@/components/plataforma/gerenciar-conta";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-client";
import { SITE_URL } from "@/lib/site";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";

type SituacaoDaCobranca =
  | "pagante"
  | "liberada"
  | "plataforma"
  | "carencia"
  | "cancelada"
  | "pendente"
  | "sem_assinatura";

interface Relatorio {
  periodo: { dias: number; desde: string; ate: string };
  resumo: {
    contas: Record<SituacaoDaCobranca, number> & { total: number; novas: number };
    receita: {
      mrr: number;
      assinantes: number;
      precoMensal: number;
      pacotesExtras: number;
      cancelamentos: number;
    };
    uso: {
      usuarios: number;
      ativosDia: number;
      ativosSemana: number;
      ativosMes: number;
      whatsappConectados: number;
      mensagens: number;
      respostasIa: number;
      conversasNovas: number;
    };
    alertas: {
      pagantesSemWhatsapp: number;
      emCarencia: number;
      errosDia: number;
      errosAbertos: number;
    };
  };
  funil: { chave: string; rotulo: string; valor: number }[];
  origens: {
    comoConheceu: {
      chave: string;
      rotulo: string;
      contas: number;
      assinaram: number;
      detalhes: string[];
    }[];
    campanhas: { nome: string; contas: number; assinaram: number }[];
  };
  serie: {
    dia: string;
    visitas: number;
    contas: number;
    assinaturas: number;
    ativos: number;
    mensagens: number;
  }[];
}

interface Conta {
  id: string;
  nome: string;
  criadaEm: string;
  dono: { nome: string; email: string } | null;
  origem: string | null;
  cobranca: SituacaoDaCobranca;
  liberadoAte: string | null;
  liberadoNota: string | null;
  temAssinatura: boolean;
  daPlataforma: boolean;
  usuarios: number;
  whatsapp: string | null;
  conversas30d: number;
  ia: { usadas: number; limite: number } | null;
  ultimoAcesso: string | null;
}

interface Erro {
  id: string;
  origem: "api" | "web";
  mensagem: string;
  pilha: string | null;
  rota: string | null;
  status: number | null;
  ocorrencias: number;
  tenantId: string | null;
  primeiraVez: string;
  ultimaVez: string;
  resolvido: boolean;
}

const ABAS = [
  { chave: "geral", rotulo: "Visão geral" },
  { chave: "funil", rotulo: "Funil" },
  { chave: "origem", rotulo: "Origem" },
  { chave: "contas", rotulo: "Contas" },
  { chave: "conexoes", rotulo: "Conexões" },
  { chave: "erros", rotulo: "Erros" },
] as const;
type Aba = (typeof ABAS)[number]["chave"];

const COBRANCA: Record<SituacaoDaCobranca, { rotulo: string; classe: string }> = {
  pagante: { rotulo: "Pagante", classe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  liberada: { rotulo: "Liberada", classe: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  plataforma: { rotulo: "Master", classe: "bg-violet-500/15 text-violet-700 dark:text-violet-400" },
  carencia: { rotulo: "Em carência", classe: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  pendente: { rotulo: "Pagamento pendente", classe: "bg-destructive/15 text-destructive" },
  cancelada: { rotulo: "Cancelada", classe: "bg-muted text-muted-foreground" },
  sem_assinatura: { rotulo: "Sem assinatura", classe: "bg-muted text-muted-foreground" },
};

const reais = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const inteiro = (valor: number) => valor.toLocaleString("pt-BR");
const porcento = (parte: number, todo: number) =>
  todo > 0 ? `${Math.round((parte / todo) * 100)}%` : "—";
const data = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" })
    : "—";
const dataEHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** "há 3 dias" — pra último acesso, onde a data exata importa menos que a distância. */
function ha(iso: string | null) {
  if (!iso) return "Nunca";
  const horas = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (horas < 1) return "Agora há pouco";
  if (horas < 24) return `Há ${Math.round(horas)} h`;
  const dias = Math.round(horas / 24);
  return `Há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

/**
 * O painel do dono da plataforma.
 *
 * Responde, nesta ordem, o que se pergunta ao abrir: quanto entra (receita
 * e contas pagantes), onde as pessoas desistem (funil), de onde elas vêm
 * (origem), quem está e quem não está dando certo (contas) e o que está
 * quebrando (erros). Os alertas do topo são o que pede ação hoje.
 */
export default function PlataformaPage() {
  const [aba, setAba] = useState<Aba>("geral");
  const [dias, setDias] = useState(30);
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [erroDeAcesso, setErroDeAcesso] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    apiFetch<Relatorio>(`/plataforma/relatorio?dias=${dias}`)
      .then((r) => {
        if (!cancelado) setRelatorio(r);
      })
      .catch((erro) => {
        if (cancelado) return;
        setErroDeAcesso(
          erro instanceof ApiError && erro.status === 403
            ? "Esta página é só do dono da plataforma."
            : "Não deu pra carregar os relatórios agora.",
        );
      });
    return () => {
      cancelado = true;
    };
  }, [dias]);

  if (erroDeAcesso) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Plataforma" />
        <p className="text-sm text-muted-foreground">{erroDeAcesso}</p>
      </div>
    );
  }

  return (
    <div className="viz flex flex-col gap-6">
      <PageHeader
        title="Plataforma"
        description="Receita, funil, origem das contas, uso e erros de todas as empresas."
        action={
          <div className="flex items-center gap-0.5 rounded-lg border bg-muted/70 p-0.5">
            {[7, 30, 90].map((opcao) => (
              <button
                key={opcao}
                type="button"
                onClick={() => {
                  setRelatorio(null);
                  setDias(opcao);
                }}
                aria-pressed={dias === opcao}
                className={cn(
                  "rounded-md px-3 py-1 text-sm transition-colors",
                  dias === opcao
                    ? "bg-card text-foreground shadow-xs ring-1 ring-border"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opcao} dias
              </button>
            ))}
          </div>
        }
      />

      <Alertas relatorio={relatorio} onIr={setAba} />

      <nav className="-mb-2 flex gap-1 overflow-x-auto border-b" aria-label="Relatórios">
        {ABAS.map((item) => (
          <button
            key={item.chave}
            type="button"
            onClick={() => setAba(item.chave)}
            aria-current={aba === item.chave ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
              aba === item.chave
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.rotulo}
          </button>
        ))}
      </nav>

      {aba === "geral" ? <VisaoGeral relatorio={relatorio} /> : null}
      {aba === "funil" ? <Funil relatorio={relatorio} /> : null}
      {aba === "origem" ? <Origem relatorio={relatorio} /> : null}
      {aba === "contas" ? <Contas /> : null}
      {aba === "conexoes" ? <Conexoes /> : null}
      {aba === "erros" ? <Erros /> : null}
    </div>
  );
}

/** O que pede ação hoje — só aparece o que não está zerado. */
function Alertas({
  relatorio,
  onIr,
}: {
  relatorio: Relatorio | null;
  onIr: (aba: Aba) => void;
}) {
  if (!relatorio) return null;
  const { alertas } = relatorio.resumo;
  const itens = [
    alertas.pagantesSemWhatsapp > 0 && {
      texto: `${alertas.pagantesSemWhatsapp} ${alertas.pagantesSemWhatsapp === 1 ? "conta pagante está" : "contas pagantes estão"} com o WhatsApp desconectado`,
      aba: "contas" as Aba,
    },
    alertas.emCarencia > 0 && {
      texto: `${alertas.emCarencia} em carência — o pagamento falhou e a conta bloqueia em até 2 dias`,
      aba: "contas" as Aba,
    },
    alertas.errosDia > 0 && {
      texto: `${alertas.errosDia} ${alertas.errosDia === 1 ? "erro aconteceu" : "erros aconteceram"} nas últimas 24 h`,
      aba: "erros" as Aba,
    },
  ].filter(Boolean) as { texto: string; aba: Aba }[];

  if (itens.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {itens.map((item) => (
        <button
          key={item.texto}
          type="button"
          onClick={() => onIr(item.aba)}
          className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-sm transition-colors hover:bg-amber-500/15"
        >
          <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          {item.texto}
        </button>
      ))}
    </div>
  );
}

function VisaoGeral({ relatorio }: { relatorio: Relatorio | null }) {
  const carregando = !relatorio;
  const r = relatorio?.resumo;
  const rotulos = useMemo(
    () =>
      relatorio?.serie.map((p) =>
        new Date(`${p.dia}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      ) ?? [],
    [relatorio],
  );

  const blocos: {
    titulo: string;
    itens: { label: string; value: string; hint?: string; icon: typeof Users }[];
  }[] = [
    {
      titulo: "Receita",
      itens: [
        {
          label: "Receita mensal (MRR)",
          value: r ? reais(r.receita.mrr) : "",
          hint: r ? `${r.receita.assinantes} assinantes × ${reais(r.receita.precoMensal)}` : undefined,
          icon: Banknote,
        },
        {
          label: "Contas pagantes",
          // Quem assina no Stripe — inclusive quem está com dias de folga
          // liberados à mão (aparece como "Liberada" na lista, mas paga).
          value: r ? inteiro(r.receita.assinantes) : "",
          hint: r
            ? `de ${inteiro(r.contas.total)} contas${r.contas.liberada ? ` · ${inteiro(r.contas.liberada)} liberadas à mão` : ""}`
            : undefined,
          icon: CreditCard,
        },
        {
          label: "Cancelamentos no período",
          value: r ? inteiro(r.receita.cancelamentos) : "",
          icon: UserMinus,
        },
        {
          label: "Pacotes extras vendidos",
          value: r ? inteiro(r.receita.pacotesExtras) : "",
          icon: Package,
        },
      ],
    },
    {
      titulo: "Crescimento e uso",
      itens: [
        {
          label: "Contas novas no período",
          value: r ? inteiro(r.contas.novas) : "",
          icon: UserPlus,
        },
        {
          label: "Pessoas ativas hoje",
          value: r ? inteiro(r.uso.ativosDia) : "",
          hint: r
            ? `${inteiro(r.uso.ativosSemana)} na semana · ${inteiro(r.uso.ativosMes)} no mês`
            : undefined,
          icon: Users,
        },
        {
          label: "WhatsApps conectados",
          value: r ? inteiro(r.uso.whatsappConectados) : "",
          icon: Smartphone,
        },
        {
          label: "Mensagens no período",
          value: r ? inteiro(r.uso.mensagens) : "",
          hint: r
            ? `${inteiro(r.uso.respostasIa)} da IA · ${inteiro(r.uso.conversasNovas)} conversas`
            : undefined,
          icon: MessageSquare,
        },
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {blocos.map((bloco) => (
        <section key={bloco.titulo} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{bloco.titulo}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {bloco.itens.map((item) => (
              <StatTile key={item.label} {...item} loading={carregando} />
            ))}
          </div>
        </section>
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Visitas e contas criadas</CardTitle>
          </CardHeader>
          <CardContent>
            {relatorio ? (
              <LineChart
                labels={rotulos}
                valueLabel="Por dia"
                series={[
                  {
                    key: "visitas",
                    label: "Visitantes na página",
                    color: "var(--viz-series-1)",
                    points: relatorio.serie.map((p) => p.visitas),
                  },
                  {
                    key: "contas",
                    label: "Contas criadas",
                    color: "var(--viz-series-2)",
                    points: relatorio.serie.map((p) => p.contas),
                  },
                ]}
              />
            ) : (
              <Skeleton className="h-[220px] w-full" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pessoas usando o painel</CardTitle>
          </CardHeader>
          <CardContent>
            {relatorio ? (
              <LineChart
                labels={rotulos}
                valueLabel="Pessoas por dia"
                series={[
                  {
                    key: "ativos",
                    label: "Pessoas ativas",
                    color: "var(--viz-series-1)",
                    points: relatorio.serie.map((p) => p.ativos),
                  },
                ]}
              />
            ) : (
              <Skeleton className="h-[220px] w-full" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mensagens por dia (todas as contas)</CardTitle>
          </CardHeader>
          <CardContent>
            {relatorio ? (
              <LineChart
                labels={rotulos}
                valueLabel="Mensagens"
                series={[
                  {
                    key: "mensagens",
                    label: "Mensagens",
                    color: "var(--viz-series-1)",
                    points: relatorio.serie.map((p) => p.mensagens),
                  },
                ]}
              />
            ) : (
              <Skeleton className="h-[220px] w-full" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Situação da cobrança</CardTitle>
          </CardHeader>
          <CardContent>
            {r ? (
              <BarChart
                valueLabel="Contas"
                data={(Object.keys(COBRANCA) as SituacaoDaCobranca[]).map((chave) => ({
                  label: COBRANCA[chave].rotulo,
                  value: r.contas[chave],
                }))}
              />
            ) : (
              <Skeleton className="h-[180px] w-full" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * Onde as pessoas desistem.
 *
 * Cada passo mostra quantos chegaram, a fração do começo e a fração do
 * passo anterior — e o passo com a maior perda vem marcado, porque é ali
 * que vale mexer primeiro.
 */
function Funil({ relatorio }: { relatorio: Relatorio | null }) {
  if (!relatorio) return <Skeleton className="h-96 w-full" />;
  const passos = relatorio.funil;
  const topo = Math.max(1, passos[0]?.valor ?? 0);

  let piorIndice = -1;
  let piorQueda = 0;
  passos.forEach((passo, i) => {
    if (i === 0) return;
    const anterior = passos[i - 1].valor;
    const queda = anterior > 0 ? 1 - passo.valor / anterior : 0;
    if (anterior >= 3 && queda > piorQueda) {
      piorQueda = queda;
      piorIndice = i;
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Do primeiro clique ao cliente usando</CardTitle>
        <p className="text-sm text-muted-foreground text-pretty">
          Até &quot;Abriram o cadastro&quot; conta visitantes distintos no período. De &quot;Criaram
          a conta&quot; em diante, é a turma de contas criadas no período e quantas delas já
          chegaram em cada passo.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {passos.map((passo, i) => {
          const anterior = i > 0 ? passos[i - 1].valor : null;
          return (
            <div key={passo.chave} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className={cn("font-medium", i === piorIndice && "text-destructive")}>
                  {passo.rotulo}
                  {i === piorIndice ? (
                    <span className="ml-2 text-xs font-normal">maior perda</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  <span className="font-semibold text-foreground">{inteiro(passo.valor)}</span>
                  {anterior !== null ? ` · ${porcento(passo.valor, anterior)} do passo anterior` : ""}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width]",
                    i === piorIndice ? "bg-destructive" : "bg-[var(--viz-series-1)]",
                  )}
                  style={{ width: `${Math.max(1.5, (passo.valor / topo) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** De onde vêm as contas, e qual origem traz gente que paga. */
function Origem({ relatorio }: { relatorio: Relatorio | null }) {
  const [abertos, setAbertos] = useState<string | null>(null);
  if (!relatorio) return <Skeleton className="h-96 w-full" />;
  const { comoConheceu, campanhas } = relatorio.origens;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Onde conheceram (resposta do cadastro)</CardTitle>
        </CardHeader>
        <CardContent>
          {comoConheceu.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma conta nova no período.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-normal">Origem</th>
                  <th className="pb-2 text-right font-normal">Contas</th>
                  <th className="pb-2 text-right font-normal">Assinaram</th>
                  <th className="pb-2 text-right font-normal">Conversão</th>
                </tr>
              </thead>
              <tbody>
                {comoConheceu.map((linha) => (
                  <tr key={linha.chave} className="border-t align-top">
                    <td className="py-2">
                      {linha.detalhes.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setAbertos((a) => (a === linha.chave ? null : linha.chave))}
                          className="inline-flex items-center gap-1 hover:underline"
                        >
                          {linha.rotulo}
                          <ChevronDown
                            className={cn(
                              "size-3.5 transition-transform",
                              abertos === linha.chave && "rotate-180",
                            )}
                          />
                        </button>
                      ) : (
                        linha.rotulo
                      )}
                      {abertos === linha.chave ? (
                        <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                          {linha.detalhes.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="py-2 text-right tabular-nums">{inteiro(linha.contas)}</td>
                    <td className="py-2 text-right tabular-nums">{inteiro(linha.assinaram)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">
                      {porcento(linha.assinaram, linha.contas)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Campanhas (links com utm)</CardTitle>
          <p className="text-sm text-muted-foreground text-pretty">
            Use links como{" "}
            <code className="text-xs break-all">
              {SITE_URL.replace(/^https?:\/\//, "")}/?utm_source=instagram&amp;utm_campaign=bio
            </code>{" "}
            e cada campanha aparece aqui separada.
          </p>
        </CardHeader>
        <CardContent>
          {campanhas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma conta veio por link de campanha no período.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-normal">Campanha</th>
                  <th className="pb-2 text-right font-normal">Contas</th>
                  <th className="pb-2 text-right font-normal">Assinaram</th>
                  <th className="pb-2 text-right font-normal">Conversão</th>
                </tr>
              </thead>
              <tbody>
                {campanhas.map((c) => (
                  <tr key={c.nome} className="border-t">
                    <td className="py-2 break-all">{c.nome}</td>
                    <td className="py-2 text-right tabular-nums">{inteiro(c.contas)}</td>
                    <td className="py-2 text-right tabular-nums">{inteiro(c.assinaram)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">
                      {porcento(c.assinaram, c.contas)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Todas as empresas — a lista de quem acompanhar de perto. */
function Contas() {
  const [busca, setBusca] = useState("");
  const [contas, setContas] = useState<Conta[] | null>(null);
  const [gerenciando, setGerenciando] = useState<Conta | null>(null);
  // Sobe a cada mudança feita pela tela de gerenciar — recarrega a lista.
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    const espera = setTimeout(() => {
      apiFetch<Conta[]>(`/plataforma/contas${busca.trim() ? `?busca=${encodeURIComponent(busca.trim())}` : ""}`)
        .then(setContas)
        .catch(() => toast.error("Não deu pra carregar as contas."));
    }, 300);
    return () => clearTimeout(espera);
  }, [busca, versao]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">
          Contas {contas ? <span className="font-normal text-muted-foreground">({contas.length})</span> : null}
        </CardTitle>
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Empresa ou e-mail"
            className="pl-8"
          />
        </div>
      </CardHeader>
      <CardContent>
        {!contas ? (
          <Skeleton className="h-64 w-full" />
        ) : contas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma conta encontrada.</p>
        ) : (
          // A tabela rola por dentro no celular — a página não.
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[940px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-normal">Empresa</th>
                  <th className="pb-2 font-normal">Cobrança</th>
                  <th className="pb-2 font-normal">WhatsApp</th>
                  <th className="pb-2 text-right font-normal">Pessoas</th>
                  <th className="pb-2 text-right font-normal">Conversas (30d)</th>
                  <th className="pb-2 pr-3 text-right font-normal">IA no mês</th>
                  <th className="pb-2 font-normal">Último acesso</th>
                  <th className="pb-2 font-normal">Criada</th>
                  <th className="pb-2 font-normal">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {contas.map((conta) => (
                  <tr key={conta.id} className="border-t align-top">
                    <td className="py-2.5 pr-3">
                      <p className="font-medium">{conta.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {conta.dono?.email ?? "sem dono"}
                        {conta.origem ? ` · ${conta.origem}` : ""}
                      </p>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs whitespace-nowrap",
                          COBRANCA[conta.cobranca].classe,
                        )}
                      >
                        {COBRANCA[conta.cobranca].rotulo}
                      </span>
                      {conta.cobranca === "liberada" && conta.liberadoAte ? (
                        <p
                          className="mt-1 max-w-40 truncate text-xs text-muted-foreground"
                          title={conta.liberadoNota ?? undefined}
                        >
                          até {data(conta.liberadoAte)}
                          {conta.liberadoNota ? ` · ${conta.liberadoNota}` : ""}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      {conta.whatsapp === "CONECTADO" ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <Check className="size-3.5" /> Conectado
                        </span>
                      ) : conta.whatsapp ? (
                        <span className="text-amber-700 dark:text-amber-400">Desconectado</span>
                      ) : (
                        <span className="text-muted-foreground">Nunca conectou</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{conta.usuarios}</td>
                    <td className="py-2.5 text-right tabular-nums">{inteiro(conta.conversas30d)}</td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap tabular-nums">
                      {conta.ia ? `${inteiro(conta.ia.usadas)} / ${inteiro(conta.ia.limite)}` : "—"}
                    </td>
                    <td className="py-2.5 whitespace-nowrap">{ha(conta.ultimoAcesso)}</td>
                    <td className="py-2.5 whitespace-nowrap text-muted-foreground">{data(conta.criadaEm)}</td>
                    <td className="py-1.5 pl-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setGerenciando(conta)}>
                        <Settings2 />
                        Gerenciar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <GerenciarConta
        conta={gerenciando}
        onFechar={() => setGerenciando(null)}
        onMudou={() => setVersao((v) => v + 1)}
      />
    </Card>
  );
}

/** O que está quebrando — agrupado, com a contagem e a pilha. */
interface SaudeDasConexoes {
  resumo: {
    conectadas: number;
    caidas: number;
    aguardandoQr: number;
    desconectadas: number;
    nuncaConectaram: number;
    quedasNaSemana: number;
    recuperadasNaSemana: number;
  };
  porDia: { dia: string; quedas: number; recuperadas: number }[];
  empresas: {
    tenantId: string;
    nome: string;
    situacao: "conectada" | "caida" | "aguardando_qr" | "desconectada" | "nunca_conectou";
    caidaDesde: string | null;
    motivo: string | null;
    ultimaMensagemRecebida: string | null;
    recebidasNaSemana: number;
    quedasNaSemana: number;
    recuperadasNaSemana: number;
  }[];
}

const SITUACAO_DA_CONEXAO: Record<
  SaudeDasConexoes["empresas"][number]["situacao"],
  { rotulo: string; classe: string }
> = {
  conectada: { rotulo: "Conectada", classe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  caida: { rotulo: "Caída", classe: "bg-destructive/15 text-destructive" },
  aguardando_qr: { rotulo: "Lendo QR code", classe: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  desconectada: { rotulo: "Desconectada", classe: "bg-muted text-muted-foreground" },
  nunca_conectou: { rotulo: "Nunca conectou", classe: "bg-muted text-muted-foreground" },
};

function haQuanto(iso: string | null): string {
  if (!iso) return "—";
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutos < 60) return `há ${Math.max(1, minutos)} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `há ${horas} h`;
  return `há ${Math.round(horas / 24)} dias`;
}

/**
 * A saúde do WhatsApp de cada empresa: quem caiu e desde quando, quem
 * parou de receber mensagem (a sessão "conectada" que não entrega nada é
 * o defeito mais silencioso) e quanto precisou ser recuperado.
 */
function Conexoes() {
  const [dados, setDados] = useState<SaudeDasConexoes | null>(null);
  // A hora do retrato: o "silenciosa" é medido a partir dela, não do render.
  const [retratoEm, setRetratoEm] = useState(0);

  useEffect(() => {
    let cancelado = false;
    const buscar = () =>
      apiFetch<SaudeDasConexoes>("/plataforma/conexoes")
        .then((r) => {
          if (cancelado) return;
          setDados(r);
          setRetratoEm(Date.now());
        })
        .catch(() => toast.error("Não deu pra carregar as conexões."));
    void buscar();
    // Um retrato que envelhece rápido: refaz a cada minuto com a aba aberta.
    const timer = setInterval(() => void buscar(), 60_000);
    return () => {
      cancelado = true;
      clearInterval(timer);
    };
  }, []);

  if (!dados) return <Skeleton className="h-64 w-full" />;
  const { resumo } = dados;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Conectadas"
          value={String(resumo.conectadas)}
          hint={`${resumo.aguardandoQr} lendo QR · ${resumo.nuncaConectaram} nunca conectaram`}
          icon={Wifi}
        />
        <StatTile
          label="Caídas agora"
          value={String(resumo.caidas)}
          hint={`${resumo.desconectadas} desconectadas pelo botão`}
          icon={WifiOff}
        />
        <StatTile
          label="Quedas na semana"
          value={String(resumo.quedasNaSemana)}
          hint="avisadas ao dono (mais de 5 min)"
          icon={AlertTriangle}
        />
        <StatTile
          label="Mensagens recuperadas"
          value={String(resumo.recuperadasNaSemana)}
          hint="na semana, trazidas do servidor ao abrir a conversa"
          icon={History}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Empresas</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {dados.empresas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma empresa com WhatsApp ainda.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Empresa</th>
                  <th className="py-2 pr-3 font-medium">Situação</th>
                  <th className="py-2 pr-3 font-medium">Última recebida</th>
                  <th className="py-2 pr-3 text-right font-medium">Recebidas (7d)</th>
                  <th className="py-2 pr-3 text-right font-medium">Quedas (7d)</th>
                  <th className="py-2 text-right font-medium">Recuperadas (7d)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {dados.empresas.map((e) => {
                  const situacao = SITUACAO_DA_CONEXAO[e.situacao];
                  // Conectada e sem nada recebido em 2 dias merece um olhar:
                  // pode ser só movimento fraco, ou a sessão que não entrega.
                  const silenciosa =
                    e.situacao === "conectada" &&
                    (!e.ultimaMensagemRecebida ||
                      retratoEm - new Date(e.ultimaMensagemRecebida).getTime() > 48 * 3600_000);
                  return (
                    <tr key={e.tenantId} className="align-top">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{e.nome}</span>
                        {e.motivo ? (
                          <span className="block text-xs text-muted-foreground">{e.motivo}</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", situacao.classe)}>
                          {situacao.rotulo}
                        </span>
                        {e.situacao === "caida" && e.caidaDesde ? (
                          <span className="block pt-1 text-xs text-muted-foreground">
                            {haQuanto(e.caidaDesde)}
                          </span>
                        ) : null}
                      </td>
                      <td className={cn("py-2 pr-3", silenciosa && "text-amber-700 dark:text-amber-400")}>
                        {haQuanto(e.ultimaMensagemRecebida)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{e.recebidasNaSemana}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{e.quedasNaSemana}</td>
                      <td className="py-2 text-right tabular-nums">{e.recuperadasNaSemana}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Erros() {
  const [todos, setTodos] = useState(false);
  const [erros, setErros] = useState<Erro[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    apiFetch<Erro[]>(`/plataforma/erros${todos ? "?todos=1" : ""}`)
      .then((lista) => {
        if (!cancelado) setErros(lista);
      })
      .catch(() => toast.error("Não deu pra carregar os erros."));
    return () => {
      cancelado = true;
    };
  }, [todos]);

  async function resolver(id: string) {
    await apiFetch(`/plataforma/erros/${id}/resolver`, { method: "POST" });
    setErros((lista) =>
      todos
        ? (lista ?? []).map((e) => (e.id === id ? { ...e, resolvido: true } : e))
        : (lista ?? []).filter((e) => e.id !== id),
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">Erros {todos ? "" : "em aberto"}</CardTitle>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
          Mostrar resolvidos
        </label>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!erros ? (
          <Skeleton className="h-48 w-full" />
        ) : erros.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="size-4" /> Nenhum erro em aberto.
          </p>
        ) : (
          erros.map((erro) => (
            <div
              key={erro.id}
              className={cn("rounded-lg border p-3", erro.resolvido && "opacity-60")}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setAberto((a) => (a === erro.id ? null : erro.id))}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="flex items-center gap-2 text-sm font-medium break-words">
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                        erro.origem === "api"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                      )}
                    >
                      {erro.origem === "api" ? "API" : "Tela"}
                    </span>
                    {erro.mensagem}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {erro.rota ? (
                      <span className="inline-flex items-center gap-1">
                        <Globe className="size-3" />
                        {erro.rota}
                      </span>
                    ) : null}
                    <span>
                      {inteiro(erro.ocorrencias)} {erro.ocorrencias === 1 ? "vez" : "vezes"}
                    </span>
                    <span>última: {dataEHora(erro.ultimaVez)}</span>
                    <span>primeira: {dataEHora(erro.primeiraVez)}</span>
                  </p>
                </button>
                {erro.resolvido ? (
                  <span className="text-xs text-muted-foreground">Resolvido</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void resolver(erro.id)}
                    className="rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-muted"
                  >
                    Marcar como resolvido
                  </button>
                )}
              </div>
              {aberto === erro.id && erro.pilha ? (
                <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap">
                  {erro.pilha}
                </pre>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
