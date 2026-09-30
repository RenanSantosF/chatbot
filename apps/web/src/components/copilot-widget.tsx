"use client";

import { Check, MessageSquare, Sparkles, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";

/** Uma ação que o assistente propôs e só acontece no clique. */
interface Proposta {
  token: string;
  titulo: string;
  detalhe?: string;
  estado?: "confirmando" | "feita" | "cancelada";
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  /**
   * A resposta é um aviso de falha, não uma resposta.
   *
   * Marcado pra o balão não se passar pelo que não é: "a chave foi
   * recusada pelo provedor" no mesmo cinza de uma resposta normal se lê
   * como se o assistente estivesse informando algo, quando na verdade ele
   * não conseguiu fazer o que foi pedido.
   */
  falhou?: boolean;
  propostas?: Proposta[];
  /** Conversas citadas — um clique abre no Inbox. */
  conversas?: { id: string; cliente: string }[];
}

interface Resposta {
  content: string;
  falhou?: boolean;
  propostas?: Proposta[];
  conversas?: { id: string; cliente: string }[];
}

interface Aviso {
  id: string;
  texto: string;
  pergunta: string;
  tom: "alerta" | "dica";
}

const SUGESTOES = [
  "Quem está esperando resposta?",
  "Como foi a semana?",
  "O que a IA não soube responder essa semana?",
  "O que você consegue fazer?",
];

const CHAVE_DOS_AVISOS_VISTOS = "inteliwa:avisos-vistos";
/** De quanto em quanto tempo perguntar se há algo pedindo atenção. */
const INTERVALO_DOS_AVISOS_MS = 2 * 60 * 1000;

function avisosVistos(): string {
  try {
    return localStorage.getItem(CHAVE_DOS_AVISOS_VISTOS) ?? "";
  } catch {
    return "";
  }
}

function marcarAvisosVistos(assinatura: string) {
  try {
    localStorage.setItem(CHAVE_DOS_AVISOS_VISTOS, assinatura);
  } catch {
    // Sem armazenamento, o pontinho só volta a aparecer no próximo aviso.
  }
}

/** `**negrito**` do modelo vira negrito de verdade; o resto fica como veio. */
function Formatado({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*\n]+\*\*)/g);
  return (
    <>
      {partes.map((parte, i) =>
        parte.startsWith("**") && parte.endsWith("**") ? (
          <strong key={i}>{parte.slice(2, -2)}</strong>
        ) : (
          <Fragment key={i}>{parte}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * Assistente de suporte ao operador. Fica sobre a interface toda porque a
 * pergunta ("como eu mudo X?") aparece justamente quando a pessoa está em
 * outra tela — obrigar a navegar até um lugar pra perguntar como navegar
 * seria a piada errada.
 */
export function CopilotWidget() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [vistos, setVistos] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  // No Inbox, o canto de baixo é o do botão de enviar e do microfone (a
  // coluna da direita só aparece em tela bem larga): o botão flutuante
  // sobe pra não ficar em cima deles.
  const noInbox = usePathname() === "/dashboard";

  const assinaturaDosAvisos = avisos.map((aviso) => aviso.id).join("|");
  const temNovidade = assinaturaDosAvisos !== "" && assinaturaDosAvisos !== vistos;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns, loading]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /*
   * Os avisos: de tempos em tempos e quando a aba volta ao foco.
   *
   * O pontinho some ao abrir o assistente e só volta com um aviso NOVO —
   * o mesmo "3 clientes esperando" aceso o dia inteiro vira enfeite.
   */
  const buscarAvisos = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    apiFetch<{ avisos: Aviso[] }>("/copilot/avisos")
      .then((resposta) => setAvisos(resposta.avisos))
      .catch(() => {
        // Aviso é conveniência: falhou, fica o que já estava.
      });
  }, []);

  useEffect(() => {
    setVistos(avisosVistos());
    buscarAvisos();
    const timer = window.setInterval(buscarAvisos, INTERVALO_DOS_AVISOS_MS);
    document.addEventListener("visibilitychange", buscarAvisos);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", buscarAvisos);
    };
  }, [buscarAvisos]);

  useEffect(() => {
    if (!open || !assinaturaDosAvisos) return;
    marcarAvisosVistos(assinaturaDosAvisos);
    setVistos(assinaturaDosAvisos);
  }, [open, assinaturaDosAvisos]);

  async function ask(question: string) {
    const pergunta = question.trim();
    if (!pergunta || loading) return;

    const history: Turn[] = [...turns, { role: "user", content: pergunta }];
    setTurns(history);
    setDraft("");
    setLoading(true);
    try {
      const answer = await apiFetch<Resposta>("/copilot/ask", {
        method: "POST",
        // Só o par role/content vai pro servidor: `falhou` e as propostas
        // são marcação de tela, e mandá-las de volta como parte do
        // histórico faria o modelo tentar interpretá-las.
        body: JSON.stringify({
          history: history.map(({ role, content }) => ({ role, content })),
        }),
      });
      setTurns([
        ...history,
        {
          role: "assistant",
          content: answer.content,
          falhou: answer.falhou,
          propostas: answer.propostas,
          conversas: answer.conversas,
        },
      ]);
    } catch (error) {
      setTurns([
        ...history,
        {
          role: "assistant",
          falhou: true,
          content:
            error instanceof ApiError
              ? error.message
              : "Não consegui responder agora. Tente de novo em instantes.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function mudarProposta(token: string, estado: Proposta["estado"]) {
    setTurns((atuais) =>
      atuais.map((turn) =>
        turn.propostas?.some((p) => p.token === token)
          ? {
              ...turn,
              propostas: turn.propostas.map((p) => (p.token === token ? { ...p, estado } : p)),
            }
          : turn,
      ),
    );
  }

  async function confirmar(proposta: Proposta) {
    mudarProposta(proposta.token, "confirmando");
    try {
      const resposta = await apiFetch<Resposta>("/copilot/confirmar", {
        method: "POST",
        body: JSON.stringify({ token: proposta.token }),
      });
      mudarProposta(proposta.token, resposta.falhou ? undefined : "feita");
      setTurns((atuais) => [
        ...atuais,
        { role: "assistant", content: resposta.content, falhou: resposta.falhou },
      ]);
    } catch (error) {
      mudarProposta(proposta.token, undefined);
      setTurns((atuais) => [
        ...atuais,
        {
          role: "assistant",
          falhou: true,
          content: error instanceof ApiError ? error.message : "Não deu pra confirmar agora.",
        },
      ]);
    }
  }

  function abrirConversa(id: string) {
    router.push(`/dashboard?c=${encodeURIComponent(id)}`);
    // Em tela pequena o assistente cobre a conversa que acabou de abrir.
    if (window.innerWidth < 768) setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={temNovidade ? "Abrir assistente — há avisos" : "Abrir assistente do painel"}
        data-tour="assistente"
        title={
          temNovidade
            ? avisos.map((aviso) => aviso.texto).join("\n")
            : "Assistente — pergunte ou peça uma mudança"
        }
        className={cn(
          "fixed right-5 bottom-5 z-40 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95",
          noInbox && "bottom-24 xl:bottom-5",
          // Com um anexo sendo preparado, o botão sai do caminho: ali ficam
          // o X de descartar e o de enviar, e ele ficava por cima dos dois.
          "[body:has([data-anexo-aberto])_&]:hidden",
        )}
      >
        <Sparkles className="size-5" />
        {temNovidade ? (
          <span className="absolute top-0 right-0 flex size-3.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative size-3.5 rounded-full border-2 border-background bg-amber-500" />
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div className="fixed right-5 bottom-5 z-40 flex h-[34rem] max-h-[calc(100dvh-2.5rem)] w-[24rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl bg-popover shadow-2xl ring-1 ring-border duration-200 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center gap-2 bg-primary px-3 py-2.5 text-primary-foreground">
        <Sparkles className="size-4" />
        <span className="text-sm font-semibold">Assistente</span>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => setOpen(false)}
          aria-label="Fechar assistente"
          className="ml-auto text-primary-foreground hover:bg-white/15 hover:text-primary-foreground"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {turns.length === 0 ? (
          <div className="flex flex-col gap-2">
            {avisos.map((aviso) => (
              <button
                key={aviso.id}
                type="button"
                onClick={() => void ask(aviso.pergunta)}
                className={cn(
                  "flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                  aviso.tom === "alerta"
                    ? "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15"
                    : "border-primary/25 bg-primary/5 hover:bg-primary/10",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-1 size-1.5 shrink-0 rounded-full",
                    aviso.tom === "alerta" ? "bg-amber-500" : "bg-primary",
                  )}
                />
                {aviso.texto}
              </button>
            ))}
            <p className="text-sm text-muted-foreground">
              Pergunte sobre as conversas, peça um relatório ou um ajuste — eu confiro e, quando
              dá, faço por você.
            </p>
            {SUGESTOES.map((sugestao) => (
              <button
                key={sugestao}
                type="button"
                onClick={() => void ask(sugestao)}
                className="rounded-lg bg-muted px-3 py-2 text-left text-xs transition-colors hover:bg-accent"
              >
                {sugestao}
              </button>
            ))}
          </div>
        ) : (
          turns.map((turn, index) => (
            <div
              key={index}
              className={cn(
                "flex max-w-[90%] flex-col gap-1.5",
                turn.role === "user" ? "self-end" : "self-start",
              )}
            >
              <div
                className={cn(
                  "rounded-xl px-3 py-2 text-sm whitespace-pre-wrap",
                  turn.role === "user"
                    ? "rounded-br-sm bg-primary text-primary-foreground"
                    : turn.falhou
                      ? "rounded-bl-sm border border-destructive/30 bg-destructive/10 text-foreground"
                      : "rounded-bl-sm bg-muted",
                )}
              >
                {turn.role === "assistant" ? <Formatado texto={turn.content} /> : turn.content}
              </div>

              {turn.conversas?.length ? (
                <div className="flex flex-wrap gap-1">
                  {turn.conversas.map((conversa) => (
                    <button
                      key={conversa.id}
                      type="button"
                      onClick={() => abrirConversa(conversa.id)}
                      className="flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      <MessageSquare className="size-3 shrink-0" />
                      <span className="truncate">{conversa.cliente}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {turn.propostas?.map((proposta) => (
                <div
                  key={proposta.token}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border bg-card p-2.5 text-xs",
                    proposta.estado === "cancelada" && "opacity-50",
                  )}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">{proposta.titulo}</span>
                    {proposta.detalhe ? (
                      <span className="line-clamp-4 whitespace-pre-wrap text-muted-foreground">
                        {proposta.detalhe}
                      </span>
                    ) : null}
                  </div>
                  {proposta.estado === "feita" ? (
                    <span className="flex items-center gap-1 font-medium text-primary">
                      <Check className="size-3.5" /> Feito
                    </span>
                  ) : proposta.estado === "cancelada" ? (
                    <span className="text-muted-foreground">Cancelado</span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        disabled={proposta.estado === "confirmando"}
                        onClick={() => void confirmar(proposta)}
                      >
                        {proposta.estado === "confirmando" ? <Spinner /> : <Check className="size-3.5" />}
                        Confirmar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={proposta.estado === "confirmando"}
                        onClick={() => mudarProposta(proposta.token, "cancelada")}
                      >
                        Cancelar
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
        {loading ? (
          <div className="self-start rounded-xl rounded-bl-sm bg-muted px-3 py-2">
            <Spinner />
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-center gap-2 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft);
        }}
      >
        <Input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Pergunte ou peça algo..."
          disabled={loading}
          className="h-9 text-sm"
        />
      </form>
    </div>
  );
}
