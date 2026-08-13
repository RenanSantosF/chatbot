"use client";

import { Smile } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Emojis por assunto, escritos à mão e curtos de propósito.
 *
 * A alternativa seria uma biblioteca com os ~3.700 emojis do padrão
 * Unicode e busca por nome. Não vale o peso aqui: quem atende usa os
 * mesmos vinte o dia inteiro — confirma, agradece, lamenta, comemora — e
 * uma grade que cabe na tela sem rolar é mais rápida que qualquer busca.
 */
const GRUPOS: { titulo: string; emojis: string[] }[] = [
  {
    titulo: "Reação",
    emojis: ["👍", "👌", "🙏", "👏", "🤝", "💪", "🎉", "✅", "❌", "⚠️"],
  },
  {
    titulo: "Rosto",
    emojis: ["😀", "😁", "😂", "🙂", "😉", "😍", "🤔", "😅", "😢", "😡"],
  },
  {
    titulo: "Atendimento",
    emojis: ["📎", "📄", "📅", "⏰", "📍", "📞", "💬", "💰", "🚚", "❤️"],
  },
];

/**
 * Carinhas pro compositor. Insere no rascunho em vez de enviar sozinho:
 * emoji quase sempre acompanha texto ("Perfeito 👍"), e um clique que
 * dispara mensagem é fácil de dar sem querer.
 */
export function EmojiPicker({
  disabled,
  onPick,
}: {
  disabled?: boolean;
  onPick: (emoji: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
        onClick={() => setAberto((estava) => !estava)}
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
          className="absolute bottom-full left-0 z-30 mb-2 w-64 rounded-xl bg-popover p-2.5 shadow-[0_8px_28px_oklch(0_0_0/20%)] duration-150 animate-in fade-in slide-in-from-bottom-1"
        >
          <div className="flex flex-col gap-2">
            {GRUPOS.map((grupo) => (
              <div key={grupo.titulo} className="flex flex-col gap-1">
                <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  {grupo.titulo}
                </span>
                <div className="grid grid-cols-10 gap-0.5">
                  {grupo.emojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      title={emoji}
                      onClick={() => onPick(emoji)}
                      className="rounded-md py-0.5 text-[19px] leading-none transition-transform hover:scale-125"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
