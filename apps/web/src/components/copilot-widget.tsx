"use client";

import { Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";

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
}

const SUGESTOES = [
  "Como está a fila hoje?",
  "Desliga a confirmação de leitura",
  "O que a IA está configurada pra fazer?",
];

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
  const endRef = useRef<HTMLDivElement | null>(null);

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

  async function ask(question: string) {
    const pergunta = question.trim();
    if (!pergunta || loading) return;

    const history: Turn[] = [...turns, { role: "user", content: pergunta }];
    setTurns(history);
    setDraft("");
    setLoading(true);
    try {
      const answer = await apiFetch<{ content: string; falhou?: boolean }>(
        "/copilot/ask",
        {
          method: "POST",
          // Só o par role/content vai pro servidor: `falhou` é marcação de
          // tela, e mandá-la de volta como parte do histórico faria o
          // modelo tentar interpretá-la.
          body: JSON.stringify({
            history: history.map(({ role, content }) => ({ role, content })),
          }),
        },
      );
      setTurns([
        ...history,
        { role: "assistant", content: answer.content, falhou: answer.falhou },
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir assistente do painel"
        title="Assistente — pergunte ou peça uma mudança"
        className="fixed right-5 bottom-5 z-40 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        <Sparkles className="size-5" />
      </button>
    );
  }

  return (
    <div className="fixed right-5 bottom-5 z-40 flex h-[30rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl bg-popover shadow-2xl ring-1 ring-border duration-200 animate-in fade-in slide-in-from-bottom-4">
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
            <p className="text-sm text-muted-foreground">
              Pergunte como algo funciona ou peça uma mudança — eu mexo na configuração por você.
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
                "max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap",
                turn.role === "user"
                  ? "self-end rounded-br-sm bg-primary text-primary-foreground"
                  : turn.falhou
                    ? "self-start rounded-bl-sm border border-destructive/30 bg-destructive/10 text-foreground"
                    : "self-start rounded-bl-sm bg-muted",
              )}
            >
              {turn.content}
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
