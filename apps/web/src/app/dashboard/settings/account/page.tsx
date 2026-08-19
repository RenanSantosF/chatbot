"use client";

import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

interface ResumoDaConta {
  nome: string;
  conversas: number;
  clientes: number;
  mensagens: number;
  pessoas: number;
  assinaturaAtiva: boolean;
  plano: string;
}

/** "1.284 mensagens" — plural certo e milhar separado, sem biblioteca. */
function contagem(n: number, singular: string, plural: string) {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? singular : plural}`;
}

export default function AccountPage() {
  const router = useRouter();
  const [resumo, setResumo] = useState<ResumoDaConta | null>(null);
  const [abriu, setAbriu] = useState(false);
  const [nomeDigitado, setNomeDigitado] = useState("");
  const [senha, setSenha] = useState("");
  const [apagando, setApagando] = useState(false);

  useEffect(() => {
    apiFetch<ResumoDaConta>("/account")
      .then(setResumo)
      .catch(() => toast.error("Não deu pra carregar os dados da conta."));
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

  if (!resumo) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold">Conta</h2>
        <p className="text-sm text-muted-foreground">
          {resumo.nome} — plano {resumo.plano}.
        </p>
      </div>

      <div className="rounded-lg border border-destructive/40">
        <div className="flex items-start gap-3 border-b border-destructive/40 bg-destructive/5 p-4">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <h3 className="text-sm font-medium">Apagar esta conta</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Some tudo, e não tem como voltar atrás: o histórico de atendimento
              inteiro, os clientes, os anexos guardados e os acessos de todo mundo.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <ul className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            <li>{contagem(resumo.conversas, "conversa", "conversas")}</li>
            <li>{contagem(resumo.mensagens, "mensagem", "mensagens")}</li>
            <li>{contagem(resumo.clientes, "cliente", "clientes")}</li>
            <li>{contagem(resumo.pessoas, "pessoa na equipe", "pessoas na equipe")}</li>
          </ul>

          {/* O WhatsApp é desconectado junto — dito aqui porque é a única
              parte que acontece FORA do painel, no aparelho de alguém. */}
          <p className="text-sm text-muted-foreground">
            O WhatsApp conectado é desvinculado no mesmo passo. Os clientes que
            escreverem depois disso não recebem resposta nenhuma — nem aviso.
          </p>

          {resumo.assinaturaAtiva ? (
            <p className="rounded-md bg-muted p-3 text-sm">
              Esta conta tem uma assinatura ativa. Cancele a assinatura antes de
              apagar — do contrário a cobrança continuaria correndo sem nenhuma
              conta pra cancelá-la.
            </p>
          ) : !abriu ? (
            <div>
              <Button variant="destructive" size="sm" onClick={() => setAbriu(true)}>
                Quero apagar a conta
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 border-t pt-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="nome-da-empresa" className="text-xs">
                  Digite <span className="font-semibold">{resumo.nome}</span> pra
                  confirmar
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
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!nomeConfere || senha.length === 0 || apagando}
                  onClick={() => void apagar()}
                >
                  {apagando ? <Spinner className="size-3.5" /> : null}
                  Apagar para sempre
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={apagando}
                  onClick={() => {
                    setAbriu(false);
                    setNomeDigitado("");
                    setSenha("");
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
