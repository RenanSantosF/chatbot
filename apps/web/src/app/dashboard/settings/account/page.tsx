"use client";

import {
  ChevronRight,
  HardDrive,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { SubscriptionCard } from "@/components/settings/subscription-card";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { AVISAR_A_PARTIR_DE, tamanhoLegivel } from "@/lib/armazenamento";
import { cn } from "@/lib/utils";

interface ResumoDaConta {
  nome: string;
  conversas: number;
  clientes: number;
  mensagens: number;
  pessoas: number;
  assinaturaAtiva: boolean;
  plano: string;
  criadaEm?: string;
  armazenamento?: { usadoBytes: number; cotaBytes: number } | null;
}

interface UsoDaIa {
  usadas: number;
  limite: number;
  extras: number;
}

/** "1.284 mensagens" — plural certo e milhar separado, sem biblioteca. */
function contagem(n: number, singular: string, plural: string) {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? singular : plural}`;
}

/** Uma barra de consumo com o número em cima — o mesmo desenho pros dois. */
function Consumo({
  icone: Icone,
  titulo,
  valor,
  detalhe,
  fracao,
  acao,
}: {
  icone: typeof Sparkles;
  titulo: string;
  valor: string;
  detalhe: string;
  fracao: number;
  acao: React.ReactNode;
}) {
  const apertado = fracao >= AVISAR_A_PARTIR_DE;
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icone className="size-4" />
        {titulo}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-lg font-semibold tabular-nums">{valor}</span>
        <span className="text-xs text-muted-foreground">{detalhe}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            apertado ? "bg-amber-500" : "bg-primary",
          )}
          style={{ width: `${Math.min(100, Math.max(fracao * 100, 1))}%` }}
        />
      </div>
      <div className="mt-auto">{acao}</div>
    </div>
  );
}

/**
 * A conta da empresa: plano, consumo do mês e o que ela guarda.
 *
 * O apagar mora no rodapé como um link miúdo, de propósito. Antes ele era
 * a maior coisa da tela — um cartão vermelho com botão, o primeiro convite
 * que o dono via ao abrir "Conta". Quem quer mesmo apagar procura e acha;
 * quem só veio ver o plano não precisa ser lembrado de que dá.
 */
export default function AccountPage() {
  const router = useRouter();
  const [resumo, setResumo] = useState<ResumoDaConta | null>(null);
  const [uso, setUso] = useState<UsoDaIa | null>(null);
  const [abriu, setAbriu] = useState(false);
  const [nomeDigitado, setNomeDigitado] = useState("");
  const [senha, setSenha] = useState("");
  const [apagando, setApagando] = useState(false);

  useEffect(() => {
    apiFetch<ResumoDaConta>("/account")
      .then(setResumo)
      .catch(() => toast.error("Não deu pra carregar os dados da conta."));
    apiFetch<UsoDaIa>("/ai/settings/uso")
      .then(setUso)
      .catch(() => undefined);
  }, []);

  // O botão só acende com o nome batendo. A conferência de verdade é no
  // servidor; esta é só pra pessoa ver que ainda não está valendo.
  const nomeConfere =
    Boolean(resumo) &&
    nomeDigitado.trim().toLocaleLowerCase("pt-BR") ===
      resumo!.nome.trim().toLocaleLowerCase("pt-BR");

  async function apagar() {
    setApagando(true);
    try {
      await apiFetch("/account", {
        method: "DELETE",
        body: JSON.stringify({ password: senha, confirmacao: nomeDigitado }),
      });
      // A sessão morreu junto com a conta; sair daqui é o único caminho.
      toast.success("Conta apagada.");
      router.push("/login");
      router.refresh();
    } catch (erro) {
      setApagando(false);
      toast.error(
        erro instanceof ApiError ? erro.message : "Não deu pra apagar a conta.",
      );
    }
  }

  function fechar() {
    setAbriu(false);
    setNomeDigitado("");
    setSenha("");
  }

  if (!resumo) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      </div>
    );
  }

  const desde = resumo.criadaEm
    ? new Date(resumo.criadaEm).toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
      })
    : null;
  const espaco = resumo.armazenamento;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">{resumo.nome}</h2>
        {desde ? (
          <p className="text-sm text-muted-foreground">Cliente desde {desde}</p>
        ) : null}
      </div>

      <SubscriptionCard />

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Consumo</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {uso ? (
            <Consumo
              icone={Sparkles}
              titulo="Respostas de IA neste mês"
              valor={`${uso.usadas.toLocaleString("pt-BR")} de ${uso.limite.toLocaleString("pt-BR")}`}
              detalhe={
                uso.extras > 0
                  ? `Inclui ${uso.extras.toLocaleString("pt-BR")} compradas — não vencem na virada do mês.`
                  : "Renovam todo dia 1º. Atendimento humano não entra na conta."
              }
              fracao={uso.usadas / Math.max(uso.limite, 1)}
              acao={
                resumo.assinaturaAtiva ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="-ml-2"
                    render={<Link href="/dashboard/mensagens-extras" />}
                  >
                    Comprar mais respostas
                    <ChevronRight className="size-3.5" />
                  </Button>
                ) : null
              }
            />
          ) : (
            <Skeleton className="h-40 rounded-xl" />
          )}
          {espaco ? (
            <Consumo
              icone={HardDrive}
              titulo="Armazenamento"
              valor={`${tamanhoLegivel(espaco.usadoBytes)} de ${tamanhoLegivel(espaco.cotaBytes)}`}
              detalhe="Conversas, fotos, áudios e documentos guardados."
              fracao={espaco.usadoBytes / Math.max(espaco.cotaBytes, 1)}
              acao={
                <Button
                  size="sm"
                  variant="ghost"
                  className="-ml-2"
                  render={<Link href="/dashboard/settings/storage" />}
                >
                  Ver detalhes
                  <ChevronRight className="size-3.5" />
                </Button>
              }
            />
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">O que a conta guarda</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { rotulo: "conversas", valor: resumo.conversas },
            { rotulo: "mensagens", valor: resumo.mensagens },
            { rotulo: "clientes", valor: resumo.clientes },
            { rotulo: resumo.pessoas === 1 ? "pessoa na equipe" : "pessoas na equipe", valor: resumo.pessoas },
          ].map((item) => (
            <div key={item.rotulo} className="rounded-lg bg-muted/60 px-3 py-2.5">
              <p className="text-base font-semibold tabular-nums">
                {item.valor.toLocaleString("pt-BR")}
              </p>
              <p className="text-xs text-muted-foreground">{item.rotulo}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="mb-2 text-sm font-medium">Atalhos</h3>
        {[
          { href: "/dashboard/settings/team", icone: Users, rotulo: "Equipe e convites" },
          { href: "/dashboard/settings/permissions", icone: ShieldCheck, rotulo: "O que cada papel pode fazer" },
          { href: "/dashboard/profile", icone: UserRound, rotulo: "Seu perfil e senha" },
        ].map((atalho) => (
          <Link
            key={atalho.href}
            href={atalho.href}
            className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted"
          >
            <atalho.icone className="size-4 text-muted-foreground" />
            {atalho.rotulo}
            <ChevronRight className="ml-auto size-4 text-muted-foreground" />
          </Link>
        ))}
      </section>

      {/* Discreto de propósito — ver o comentário do componente. */}
      <div className="border-t pt-4">
        {!abriu ? (
          <button
            type="button"
            onClick={() => setAbriu(true)}
            className="text-xs text-muted-foreground/70 underline-offset-4 transition-colors hover:text-muted-foreground hover:underline"
          >
            Encerrar e apagar a conta
          </button>
        ) : (
          <div className="flex max-w-md flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Apagar leva junto, sem volta:{" "}
              {contagem(resumo.conversas, "conversa", "conversas")},{" "}
              {contagem(resumo.mensagens, "mensagem", "mensagens")},{" "}
              {contagem(resumo.clientes, "cliente", "clientes")}, os anexos guardados e o
              acesso de {contagem(resumo.pessoas, "pessoa", "pessoas")}. O WhatsApp conectado é
              desvinculado no mesmo passo.
            </p>

            {resumo.assinaturaAtiva ? (
              <>
                <p className="text-muted-foreground">
                  Antes, cancele a assinatura em “Gerenciar assinatura” — senão a cobrança
                  continuaria sem conta pra cancelá-la.
                </p>
                <div>
                  <Button variant="ghost" size="sm" className="-ml-2" onClick={fechar}>
                    Fechar
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="nome-da-empresa" className="text-xs">
                    Digite <span className="font-semibold">{resumo.nome}</span> pra confirmar
                  </Label>
                  <Input
                    id="nome-da-empresa"
                    value={nomeDigitado}
                    autoComplete="off"
                    onChange={(e) => setNomeDigitado(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="senha-atual" className="text-xs">
                    Sua senha
                  </Label>
                  <Input
                    id="senha-atual"
                    type="password"
                    value={senha}
                    autoComplete="current-password"
                    onChange={(e) => setSenha(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" disabled={apagando} onClick={fechar}>
                    Cancelar
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={!nomeConfere || senha.length === 0 || apagando}
                    onClick={() => void apagar()}
                  >
                    {apagando ? <Spinner className="size-3.5" /> : null}
                    Apagar para sempre
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
