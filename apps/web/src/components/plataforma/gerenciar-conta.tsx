"use client";

import { CalendarPlus, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";

/** O pedaço da linha da tabela de contas que esta tela precisa. */
export interface ContaGerenciavel {
  id: string;
  nome: string;
  dono: { nome: string; email: string } | null;
  liberadoAte: string | null;
  liberadoNota: string | null;
  temAssinatura: boolean;
  daPlataforma: boolean;
}

interface ResultadoDaLiberacao {
  liberadoAte: string;
  cobrancaAdiadaPara: string | null;
  aviso: string | null;
}

const DIA = 24 * 60 * 60 * 1000;
const ATALHOS = [7, 15, 30, 60];
const MAXIMO_DE_DIAS = 365;

const diaMes = (quando: number | string) =>
  new Date(quando).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

function mensagemDe(erro: unknown, padrao: string) {
  return erro instanceof ApiError ? erro.message : padrao;
}

/**
 * Liberar dias, tirar a liberação e apagar — o que o dono da plataforma
 * faz com UMA conta.
 *
 * O texto de cada bloco diz o que acontece (ou não) no Stripe, porque é
 * ali que a confusão custaria dinheiro: liberar acesso NÃO mexe na
 * cobrança, a menos que a chave de adiar esteja ligada.
 */
export function GerenciarConta({
  conta,
  onFechar,
  onMudou,
}: {
  conta: ContaGerenciavel | null;
  onFechar: () => void;
  onMudou: () => void;
}) {
  return (
    <Sheet open={conta !== null} onOpenChange={(aberto) => (aberto ? null : onFechar())}>
      <SheetContent className="gap-0 overflow-y-auto">
        {conta ? (
          // `key`: trocar de conta zera o formulário (dias, nome digitado).
          <Conteudo key={conta.id} conta={conta} onFechar={onFechar} onMudou={onMudou} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Conteudo({
  conta,
  onFechar,
  onMudou,
}: {
  conta: ContaGerenciavel;
  onFechar: () => void;
  onMudou: () => void;
}) {
  const [dias, setDias] = useState(7);
  const [nota, setNota] = useState("");
  const [adiar, setAdiar] = useState(false);
  const [confirmacao, setConfirmacao] = useState("");
  const [ocupado, setOcupado] = useState<"liberar" | "revogar" | "apagar" | null>(null);

  // Congelado na abertura: o "agora" das contas desta tela, pra a data
  // prevista não mudar sozinha a cada letra digitada.
  const [agora] = useState(() => Date.now());
  const liberadoAte = conta.liberadoAte ? new Date(conta.liberadoAte).getTime() : null;
  const liberacaoValendo = liberadoAte !== null && liberadoAte > agora;
  const diasValidos = Number.isInteger(dias) && dias >= 1 && dias <= MAXIMO_DE_DIAS;
  // A mesma conta da API (novaLiberacao): soma ao que ainda falta.
  const previsto = Math.max(agora, liberadoAte ?? 0) + (diasValidos ? dias : 0) * DIA;
  const nomeConfere =
    confirmacao.trim().toLocaleLowerCase("pt-BR") === conta.nome.trim().toLocaleLowerCase("pt-BR");

  async function liberar() {
    setOcupado("liberar");
    try {
      const r = await apiFetch<ResultadoDaLiberacao>(`/plataforma/contas/${conta.id}/liberar`, {
        method: "POST",
        body: JSON.stringify({
          dias,
          ...(nota.trim() ? { nota: nota.trim() } : {}),
          ...(conta.temAssinatura && adiar ? { adiarCobranca: true } : {}),
        }),
      });
      toast.success(`${conta.nome} liberada até ${diaMes(r.liberadoAte)}.`, {
        description: r.cobrancaAdiadaPara
          ? `Próxima cobrança no Stripe: ${diaMes(r.cobrancaAdiadaPara)}.`
          : undefined,
      });
      if (r.aviso) toast.warning(r.aviso, { duration: 12_000 });
      onMudou();
      onFechar();
    } catch (erro) {
      toast.error(mensagemDe(erro, "Não deu pra liberar agora."));
    } finally {
      setOcupado(null);
    }
  }

  async function revogar() {
    setOcupado("revogar");
    try {
      await apiFetch(`/plataforma/contas/${conta.id}/revogar`, { method: "POST" });
      toast.success("Liberação removida.");
      onMudou();
      onFechar();
    } catch (erro) {
      toast.error(mensagemDe(erro, "Não deu pra remover a liberação."));
    } finally {
      setOcupado(null);
    }
  }

  async function apagar() {
    setOcupado("apagar");
    try {
      await apiFetch(`/plataforma/contas/${conta.id}/apagar`, {
        method: "POST",
        body: JSON.stringify({ confirmacao }),
      });
      toast.success(`${conta.nome} foi apagada.`);
      onMudou();
      onFechar();
    } catch (erro) {
      toast.error(mensagemDe(erro, "Não deu pra apagar a conta."), { duration: 12_000 });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{conta.nome}</SheetTitle>
        <SheetDescription>
          {conta.dono ? `${conta.dono.nome} · ${conta.dono.email}` : "Sem dono cadastrado"}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-6 px-4 pb-6">
        {conta.daPlataforma ? (
          <p className="rounded-lg bg-violet-500/10 p-3 text-sm text-violet-800 dark:text-violet-300">
            Conta de um dono da plataforma: usa o sistema de graça, sem prazo. Não precisa
            liberar dias.
          </p>
        ) : null}

        {liberacaoValendo ? (
          <section className="flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-sm">
              Liberada até <strong>{diaMes(liberadoAte)}</strong>
              {conta.liberadoNota ? (
                <span className="text-muted-foreground"> · {conta.liberadoNota}</span>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">
              Remover volta a conta pro que o Stripe diz{" "}
              {conta.temAssinatura ? "(ela tem assinatura, então segue liberada)" : "(sem assinatura: bloqueia na hora)"}
              . Não mexe no Stripe: se a cobrança foi adiada, continua adiada — acerte direto no
              Stripe se precisar.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              disabled={ocupado !== null}
              onClick={() => void revogar()}
            >
              {ocupado === "revogar" ? <Spinner className="size-3.5" /> : <Undo2 />}
              Remover liberação
            </Button>
          </section>
        ) : null}

        {conta.daPlataforma ? null : (
          <section className="flex flex-col gap-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <CalendarPlus className="size-4" />
              Liberar dias
            </h3>
            <div className="flex flex-wrap items-center gap-1.5">
              {ATALHOS.map((opcao) => (
                <button
                  key={opcao}
                  type="button"
                  aria-pressed={dias === opcao}
                  onClick={() => setDias(opcao)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[13px] transition-colors",
                    dias === opcao
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  {opcao} dias
                </button>
              ))}
              <Input
                type="number"
                min={1}
                max={MAXIMO_DE_DIAS}
                aria-label="Outra quantidade de dias"
                value={Number.isNaN(dias) ? "" : dias}
                onChange={(e) => setDias(e.target.valueAsNumber)}
                className="h-8 w-20"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nota-liberacao">Motivo (só você vê)</Label>
              <Input
                id="nota-liberacao"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Ex.: pagou por Pix, teste pra parceiro"
                maxLength={200}
              />
            </div>

            {conta.temAssinatura ? (
              <label className="flex items-start gap-3 rounded-lg border p-3">
                <Switch checked={adiar} onCheckedChange={setAdiar} className="mt-0.5" />
                <span className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Adiar também a próxima cobrança no Stripe</span>
                  <span className="text-xs text-muted-foreground">
                    {adiar
                      ? `Pra quem pagou por fora ou ganhou folga: a próxima cobrança é empurrada em ${diasValidos ? dias : "—"} dias, contados do fim do período que ela já pagou. Nenhum dia pago se perde e nada é cobrado agora.`
                      : "Desligado: só o acesso muda, e o Stripe continua cobrando na data de sempre."}
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sem assinatura: quando os dias acabarem, a conta é bloqueada até assinar. Se assinar
                antes, a primeira cobrança fica pro fim da liberação — ela não paga duas vezes.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {diasValidos ? (
                  <>
                    Fica liberada até <strong className="text-foreground">{diaMes(previsto)}</strong>
                    {conta.temAssinatura && adiar ? " (ou mais, se o período pago for além)" : ""}
                  </>
                ) : (
                  `Escolha de 1 a ${MAXIMO_DE_DIAS} dias.`
                )}
              </p>
              <Button
                size="sm"
                disabled={!diasValidos || ocupado !== null}
                onClick={() => void liberar()}
              >
                {ocupado === "liberar" ? <Spinner className="size-3.5" /> : null}
                Liberar {diasValidos ? dias : ""} {dias === 1 ? "dia" : "dias"}
              </Button>
            </div>
          </section>
        )}

        <section className="flex flex-col gap-3 rounded-lg border border-destructive/30 p-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <Trash2 className="size-4" />
            Apagar conta
          </h3>
          {conta.daPlataforma ? (
            <p className="text-xs text-muted-foreground">
              A conta de um dono da plataforma não pode ser apagada por aqui — tiraria o seu
              próprio acesso.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {conta.temAssinatura
                  ? "Cancela a assinatura no Stripe primeiro (sem cobrança nem reembolso proporcional) e só então apaga. Se o Stripe falhar, nada é apagado. "
                  : ""}
                Conversas, contatos, pessoas, arquivos e a conexão do WhatsApp somem para
                sempre. Não tem volta.
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirmar-apagar">
                  {/* Um span só: o Label é flex, e soltos os pedaços ganhavam espaço extra. */}
                  <span>
                    Digite <strong>{conta.nome}</strong> pra confirmar
                  </span>
                </Label>
                <Input
                  id="confirmar-apagar"
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <Button
                size="sm"
                variant="destructive"
                className="self-start"
                disabled={!nomeConfere || ocupado !== null}
                onClick={() => void apagar()}
              >
                {ocupado === "apagar" ? <Spinner className="size-3.5" /> : <Trash2 />}
                Apagar para sempre
              </Button>
            </>
          )}
        </section>
      </div>
    </>
  );
}
