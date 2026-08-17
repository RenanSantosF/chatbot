"use client";

import { Search, Smile } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { buscarEmojis, GRUPOS_DE_EMOJIS } from "@/lib/emojis";
import { cn } from "@/lib/utils";

/** Onde os últimos usados ficam entre uma sessão e outra. */
const CHAVE_RECENTES = "inbox-emojis-recentes";
const MAXIMO_RECENTES = 16;

function lerRecentes(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const bruto = window.localStorage.getItem(CHAVE_RECENTES);
    const lista: unknown = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista.filter((e) => typeof e === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Carinhas pro compositor. Insere no rascunho em vez de enviar sozinho:
 * emoji quase sempre acompanha texto ("Perfeito 👍"), e um clique que
 * dispara mensagem é fácil de dar sem querer.
 *
 * O painel fica aberto depois do clique, de propósito: quem manda um
 * emoji costuma mandar dois. Fechar a cada escolha obrigava a reabrir.
 */
export function EmojiPicker({
  disabled,
  onPick,
}: {
  disabled?: boolean;
  onPick: (emoji: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [recentes, setRecentes] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Lido na abertura, e não na montagem: localStorage não existe no
  // servidor, e ler a cada render do compositor seria desperdício.
  function abrir() {
    setRecentes(lerRecentes());
    setAberto(true);
  }

  function escolher(emoji: string) {
    onPick(emoji);
    const novos = [emoji, ...recentes.filter((e) => e !== emoji)].slice(
      0,
      MAXIMO_RECENTES,
    );
    setRecentes(novos);
    try {
      window.localStorage.setItem(CHAVE_RECENTES, JSON.stringify(novos));
    } catch {
      // Navegador com armazenamento bloqueado: os recentes valem só
      // enquanto o painel estiver aberto, e isso já é melhor que nada.
    }
  }

  useEffect(() => {
    if (!aberto) return;

    const foraDaqui = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setAberto(false);
    };
    const noEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAberto(false);
    };

    document.addEventListener("mousedown", foraDaqui);
    document.addEventListener("keydown", noEsc);
    return () => {
      document.removeEventListener("mousedown", foraDaqui);
      document.removeEventListener("keydown", noEsc);
    };
  }, [aberto]);

  const resultados = useMemo(() => buscarEmojis(busca), [busca]);
  const procurando = busca.trim().length > 0;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Emojis"
        aria-expanded={aberto}
        title="Emojis"
        disabled={disabled}
        onClick={() => (aberto ? setAberto(false) : abrir())}
        className={cn(aberto && "text-primary")}
      >
        <Smile className="size-4" />
      </Button>

      {aberto ? (
        <div
          role="dialog"
          aria-label="Escolher emoji"
          // bottom-full: o compositor fica colado no rodapé, então a grade
          // só cabe pra cima. Ancorada à esquerda porque o botão vive no
          // canto esquerdo da linha.
          className="absolute bottom-full left-0 z-30 mb-2 flex w-72 max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-popover shadow-[0_8px_28px_oklch(0_0_0/20%)] ring-1 ring-border duration-150 animate-in fade-in slide-in-from-bottom-1"
        >
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Buscar: entrega, café, carro…"
              aria-label="Buscar emoji"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex max-h-64 flex-col gap-2.5 overflow-y-auto p-2.5">
            {procurando ? (
              resultados.length > 0 ? (
                <Grade emojis={resultados} onPick={escolher} />
              ) : (
                <p className="px-1 py-4 text-center text-xs text-muted-foreground text-pretty">
                  Nenhum emoji com “{busca.trim()}”. Tente outra palavra — a
                  busca entende português.
                </p>
              )
            ) : (
              <>
                {recentes.length > 0 ? (
                  <Secao titulo="Usados por último">
                    <Grade emojis={recentes} onPick={escolher} />
                  </Secao>
                ) : null}
                {GRUPOS_DE_EMOJIS.map((grupo) => (
                  <Secao key={grupo.titulo} titulo={grupo.titulo}>
                    <Grade
                      emojis={grupo.itens.map((item) => item.e)}
                      onPick={escolher}
                    />
                  </Secao>
                ))}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Secao({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {titulo}
      </span>
      {children}
    </div>
  );
}

function Grade({
  emojis,
  onPick,
}: {
  emojis: string[];
  onPick: (emoji: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emojis.map((emoji) => (
        <button
          key={emoji}
          type="button"
          title={emoji}
          onClick={() => onPick(emoji)}
          className="rounded-md py-1 text-[20px] leading-none transition-transform hover:scale-125"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
