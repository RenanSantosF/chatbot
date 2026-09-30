"use client";

import { Sparkles, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";

/**
 * Quem usou a correção nesta aba. A conta guarda a mesma coisa no servidor
 * (`usouCorrecao`, em /auth/me), mas a sessão já carregada não sabe — e a
 * dica não pode reaparecer na mesma tarde de quem acabou de usar.
 */
let usouNestaAba = false;

/**
 * Corrigir o texto do compositor com a IA — e poder voltar atrás.
 *
 * O texto corrigido SUBSTITUI o do campo, e nada é enviado: quem atende
 * lê, ajusta se quiser e manda. Enquanto o campo tiver exatamente o texto
 * corrigido, "Desfazer" (ou Ctrl+Z) devolve o original.
 */
export function useCorrecaoDeTexto(texto: string, setTexto: (texto: string) => void) {
  const [corrigindo, setCorrigindo] = useState(false);
  const [antes, setAntes] = useState<{ original: string; corrigido: string } | null>(null);

  const corrigir = useCallback(async () => {
    const original = texto.trim();
    if (!original || corrigindo) return;
    setCorrigindo(true);
    try {
      const { texto: corrigido } = await apiFetch<{ texto: string }>("/ai/corrigir-texto", {
        method: "POST",
        body: JSON.stringify({ texto: original }),
      });
      usouNestaAba = true;
      if (corrigido === original) {
        toast("O texto já estava bom.");
        return;
      }
      setAntes({ original: texto, corrigido });
      setTexto(corrigido);
    } catch (erro) {
      toast.error(erro instanceof ApiError ? erro.message : "Não deu pra corrigir agora.");
    } finally {
      setCorrigindo(false);
    }
  }, [texto, corrigindo, setTexto]);

  // Mexeu no texto corrigido: ele virou do atendente, e o desfazer sai.
  const podeDesfazer = antes !== null && texto === antes.corrigido;

  const desfazer = useCallback(() => {
    if (!antes) return;
    setTexto(antes.original);
    setAntes(null);
  }, [antes, setTexto]);

  /** Pra ligar no onKeyDown do campo: Ctrl+J corrige, Ctrl+Z desfaz. */
  const aoTeclar = useCallback(
    (evento: React.KeyboardEvent) => {
      const comando = evento.ctrlKey || evento.metaKey;
      if (!comando || evento.altKey) return false;
      const tecla = evento.key.toLowerCase();
      if (tecla === "j") {
        evento.preventDefault();
        void corrigir();
        return true;
      }
      if (tecla === "z" && !evento.shiftKey && podeDesfazer) {
        evento.preventDefault();
        desfazer();
        return true;
      }
      return false;
    },
    [corrigir, desfazer, podeDesfazer],
  );

  return { corrigir, corrigindo, podeDesfazer, desfazer, aoTeclar };
}

/** O ✨ dentro do campo. Só aparece quando há o que corrigir. */
export function BotaoCorrigir({
  visivel,
  corrigindo,
  onClick,
}: {
  visivel: boolean;
  corrigindo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={corrigindo}
      aria-label="Corrigir o texto com IA (Ctrl+J)"
      title="Corrigir o texto com IA (Ctrl+J)"
      tabIndex={visivel ? 0 : -1}
      className={cn(
        "absolute right-1.5 bottom-1.5 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-all duration-200 hover:bg-background/60 hover:text-primary",
        visivel ? "scale-100 opacity-100" : "pointer-events-none scale-75 opacity-0",
        corrigindo && "text-primary",
      )}
    >
      {corrigindo ? <Spinner className="size-3.5" /> : <Sparkles className="size-4" />}
    </button>
  );
}

/** A faixa discreta de "corrigido" com o desfazer, logo acima do campo. */
export function FaixaDeCorrecao({ onDesfazer }: { onDesfazer: () => void }) {
  return (
    <div className="flex items-center gap-2 bg-card px-4 pt-2 text-xs text-muted-foreground duration-200 animate-in fade-in slide-in-from-bottom-1">
      <Sparkles className="size-3.5 text-primary" />
      Corrigido pela IA — revise antes de enviar.
      <button
        type="button"
        onClick={onDesfazer}
        className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted"
      >
        <Undo2 className="size-3.5" />
        Desfazer
        <kbd className="ml-1 rounded border px-1 text-[10px] whitespace-nowrap text-muted-foreground">Ctrl Z</kbd>
      </button>
    </div>
  );
}

const CHAVE_DA_DICA = "inteliwa:dica-correcao";
/** No máximo uma vez por dia — "de vez em quando", e não toda hora. */
const INTERVALO_DA_DICA_MS = 20 * 60 * 60 * 1000;
/** "Agora não" empurra a próxima pra daqui a três dias. */
const ADIAR_DICA_MS = 3 * 24 * 60 * 60 * 1000;
/** Texto mínimo pra dica fazer sentido — ninguém corrige um "ok". */
const TEXTO_MINIMO = 25;

function proximaDicaEm(): number {
  try {
    return Number(localStorage.getItem(CHAVE_DA_DICA)) || 0;
  } catch {
    return 0;
  }
}

function adiarDica(ms: number) {
  try {
    localStorage.setItem(CHAVE_DA_DICA, String(Date.now() + ms));
  } catch {
    // Sem armazenamento, a dica só não lembra do adiamento — nada quebra.
  }
}

/**
 * A dica que ensina o ✨, flutuando sobre o compositor enquanto se digita.
 *
 * Aparece com calma: só pra quem nunca usou a correção, só com uma frase
 * de verdade no campo, depois de uma pausa na digitação, e no máximo uma
 * vez por dia. Some sozinha em alguns segundos. Usou uma vez, nunca mais.
 */
export function DicaDaCorrecao({
  jaUsou,
  texto,
  onExperimentar,
}: {
  jaUsou: boolean;
  texto: string;
  onExperimentar: () => void;
}) {
  const [aberta, setAberta] = useState(false);
  const mostrouNestaTela = useRef(false);

  const elegivel = !jaUsou && !usouNestaAba && texto.trim().length >= TEXTO_MINIMO;

  useEffect(() => {
    if (!elegivel || mostrouNestaTela.current) return;
    if (Date.now() < proximaDicaEm()) return;
    // Espera uma pausa na digitação: pular na cara de quem está no meio
    // da frase é interromper, não ajudar.
    const timer = setTimeout(() => {
      mostrouNestaTela.current = true;
      adiarDica(INTERVALO_DA_DICA_MS);
      setAberta(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, [elegivel, texto]);

  // Some sozinha — e na hora em que o campo esvazia (a mensagem saiu).
  useEffect(() => {
    if (!aberta) return;
    const timer = setTimeout(() => setAberta(false), 10_000);
    return () => clearTimeout(timer);
  }, [aberta]);
  if (aberta && (!texto.trim() || usouNestaAba)) setAberta(false);

  if (!aberta) return null;

  return (
    <div
      role="status"
      className="absolute right-3 bottom-full z-20 mb-2 w-[21rem] max-w-[calc(100%-1.5rem)] origin-bottom-right rounded-xl border bg-popover p-3.5 text-popover-foreground shadow-[0_8px_30px_oklch(0_0_0/18%)] duration-300 animate-in fade-in zoom-in-95 slide-in-from-bottom-3"
    >
      <button
        type="button"
        onClick={() => setAberta(false)}
        aria-label="Fechar dica"
        className="absolute top-2 right-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
      <div className="flex gap-3">
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/15 [animation-duration:2.2s]" />
          <Sparkles className="relative size-4.5 animate-[pulsando_2.2s_ease-in-out_infinite]" />
        </span>
        <div className="flex min-w-0 flex-col gap-1 pr-4">
          <p className="text-sm font-semibold">A IA revisa seu texto</p>
          <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
            Corrige erros e deixa a mensagem mais clara, antes de enviar. Você vê o resultado e
            pode desfazer.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setAberta(false);
                onExperimentar();
              }}
              className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium whitespace-nowrap text-primary-foreground transition-[filter] hover:brightness-110"
            >
              <Sparkles className="size-3.5" />
              Corrigir agora
            </button>
            <button
              type="button"
              onClick={() => {
                adiarDica(ADIAR_DICA_MS);
                setAberta(false);
              }}
              className="rounded-md px-2 py-1 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Agora não
            </button>
            <kbd className="ml-auto rounded border px-1.5 py-0.5 text-[10px] whitespace-nowrap text-muted-foreground">
              Ctrl J
            </kbd>
          </div>
        </div>
      </div>
      {/* A setinha apontando pro ✨, no canto do campo. */}
      <span className="absolute -bottom-1.5 right-7 size-3 rotate-45 border-r border-b bg-popover" />
    </div>
  );
}
