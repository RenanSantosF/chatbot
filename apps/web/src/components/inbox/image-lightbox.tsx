"use client";

import { Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const ESCALA_MINIMA = 1;
const ESCALA_MAXIMA = 6;
/** O salto do clique: o bastante pra ler o número de um comprovante. */
const ESCALA_DO_CLIQUE = 2.5;

/**
 * Visualizador de imagem em modal. Portal no <body> pra a imagem não ficar
 * presa ao overflow das colunas do Inbox, e fechamento por Esc, clique no
 * fundo ou no X — as três formas que a pessoa vai tentar por instinto.
 *
 * Com zoom próprio. O do navegador não servia: ele amplia a PÁGINA, e a
 * foto — que ocupa uma fração fixa da tela — continuava do mesmo tamanho.
 * Aqui: clique amplia no ponto clicado (e outro clique volta), a rodinha
 * ou a pinça do touchpad aproximam em volta do cursor, e arrastar anda
 * pela foto ampliada. É o que se precisa pra ler um comprovante.
 */
export function ImageLightbox({
  src,
  alt,
  fileName,
  onClose,
}: {
  src: string;
  alt: string;
  fileName?: string;
  onClose: () => void;
}) {
  const [carregada, setCarregada] = useState<string | null>(null);
  const [escala, setEscala] = useState(1);
  const [desloc, setDesloc] = useState({ x: 0, y: 0 });
  const [arrastando, setArrastando] = useState(false);
  const imagemRef = useRef<HTMLImageElement | null>(null);
  const fundoRef = useRef<HTMLDivElement | null>(null);
  const arraste = useRef<{ x: number; y: number; dx: number; dy: number; moveu: boolean } | null>(
    null,
  );

  /** Mantém a foto ampliada dentro da tela: dá pra andar, não pra perdê-la. */
  const limitar = useCallback((x: number, y: number, s: number) => {
    const img = imagemRef.current;
    if (!img) return { x, y };
    const maxX = Math.max(0, (img.offsetWidth * s - window.innerWidth * 0.9) / 2);
    const maxY = Math.max(0, (img.offsetHeight * s - window.innerHeight * 0.9) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  }, []);

  /**
   * Muda a escala mantendo parado o ponto sob o cursor — é o que faz o
   * zoom "entrar" onde a pessoa está olhando, e não no meio da foto.
   */
  const ampliar = useCallback(
    (nova: number, ponto?: { x: number; y: number }) => {
      const s = Math.min(ESCALA_MAXIMA, Math.max(ESCALA_MINIMA, nova));
      if (s === 1) {
        setEscala(1);
        setDesloc({ x: 0, y: 0 });
        return;
      }
      // O ponto relativo ao centro da tela, onde a foto está centrada.
      const px = (ponto?.x ?? window.innerWidth / 2) - window.innerWidth / 2;
      const py = (ponto?.y ?? window.innerHeight / 2) - window.innerHeight / 2;
      const fator = s / escala;
      setEscala(s);
      setDesloc(limitar(px - (px - desloc.x) * fator, py - (py - desloc.y) * fator, s));
    },
    [limitar, escala, desloc],
  );
  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "+" || event.key === "=") return ampliar(escala * 1.5);
      if (event.key === "-") return ampliar(escala / 1.5);
      if (event.key === "0") return ampliar(1);
      if (event.key !== "Escape") return;
      /*
       * Esc fecha UMA camada por vez.
       *
       * Sem o `stopPropagation`, o mesmo Esc que fechava a foto chegava ao
       * painel da conversa — que também escuta no `document` — e fechava a
       * conversa junto. Quem só queria sair da imagem voltava pra tela de
       * "nenhuma conversa aberta" e tinha que procurar onde estava.
       *
       * Na fase de CAPTURA, e não na de bolha: os dois ouvintes estão no
       * mesmo alvo, e o do painel foi registrado primeiro — ele roda antes
       * na bolha, e aí barrar já não adianta. A captura vem antes das duas.
       * É a mesma mecânica do seletor de etiquetas.
       */
      event.stopPropagation();
      onClose();
    },
    [onClose, ampliar, escala],
  );

  // A rodinha (e a pinça do touchpad, que chega como Ctrl + rodinha)
  // amplia a foto. Ouvinte "não passivo" porque é o único jeito de impedir
  // o navegador de ampliar a página inteira no mesmo gesto.
  useEffect(() => {
    const fundo = fundoRef.current;
    if (!fundo) return;
    const aoRolar = (evento: WheelEvent) => {
      evento.preventDefault();
      const fator = Math.exp(-evento.deltaY * (evento.ctrlKey ? 0.01 : 0.0025));
      ampliar(escala * fator, { x: evento.clientX, y: evento.clientY });
    };
    fundo.addEventListener("wheel", aoRolar, { passive: false });
    return () => fundo.removeEventListener("wheel", aoRolar);
  }, [ampliar, escala]);

  useEffect(() => {
    document.addEventListener("keydown", handleKey, true);
    // Trava a rolagem de fundo enquanto o modal está aberto, senão a página
    // rola atrás da imagem e a sensação é de coisa quebrada.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      document.body.style.overflow = previous;
    };
  }, [handleKey]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={fundoRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 p-4 duration-200 animate-in fade-in supports-backdrop-filter:backdrop-blur-sm"
    >
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            ampliar(escala / 1.5);
          }}
          disabled={escala <= ESCALA_MINIMA}
          aria-label="Diminuir"
          title="Diminuir (-)"
          className="flex size-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-35"
        >
          <ZoomOut className="size-4.5" />
        </button>
        <span className="w-11 text-center text-xs text-white/70 tabular-nums">
          {Math.round(escala * 100)}%
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            ampliar(escala * 1.5);
          }}
          disabled={escala >= ESCALA_MAXIMA}
          aria-label="Ampliar"
          title="Ampliar (+)"
          className="flex size-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-35"
        >
          <ZoomIn className="size-4.5" />
        </button>
        <span className="mx-1 h-5 w-px bg-white/20" aria-hidden />
        <a
          href={src}
          download={fileName}
          onClick={(event) => event.stopPropagation()}
          aria-label="Baixar imagem"
          title="Baixar"
          className="flex size-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white"
        >
          <Download className="size-4.5" />
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          title="Fechar (Esc)"
          className="flex size-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Um giro enquanto a imagem não chega: sem ele, o visualizador
          abria com o fundo escuro e nada no meio, e parecia travado. */}
      {carregada === src ? null : (
        <span
          aria-hidden
          className="absolute size-8 animate-spin rounded-full border-2 border-white/25 border-t-white"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={src}
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        ref={imagemRef}
        draggable={false}
        onLoad={() => setCarregada(src)}
        onPointerDown={(event) => {
          if (escala === 1) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          arraste.current = {
            x: event.clientX,
            y: event.clientY,
            dx: desloc.x,
            dy: desloc.y,
            moveu: false,
          };
        }}
        onPointerMove={(event) => {
          const a = arraste.current;
          if (!a) return;
          const mx = event.clientX - a.x;
          const my = event.clientY - a.y;
          if (!a.moveu && Math.hypot(mx, my) < 4) return;
          a.moveu = true;
          setArrastando(true);
          setDesloc(limitar(a.dx + mx, a.dy + my, escala));
        }}
        onPointerUp={() => {
          // Um arraste não é um clique: soltar depois de andar pela foto
          // não pode desfazer o zoom.
          setTimeout(() => {
            arraste.current = null;
            setArrastando(false);
          }, 0);
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (arraste.current?.moveu) return;
          if (escala === 1) {
            ampliar(ESCALA_DO_CLIQUE, { x: event.clientX, y: event.clientY });
          } else {
            ampliar(1);
          }
        }}
        style={{
          transform: `translate(${desloc.x}px, ${desloc.y}px) scale(${escala})`,
        }}
        className={cn(
          "max-h-[88vh] max-w-full rounded-md object-contain shadow-2xl transition-[opacity,transform] duration-200 select-none",
          // Durante o arraste, sem transição: a foto acompanha o dedo.
          arrastando && "transition-none",
          escala === 1 ? "cursor-zoom-in" : arrastando ? "cursor-grabbing" : "cursor-grab",
          carregada === src ? "opacity-100" : "opacity-0",
        )}
      />
    </div>,
    document.body,
  );
}
