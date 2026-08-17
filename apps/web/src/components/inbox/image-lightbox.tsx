"use client";

import { Download, X } from "lucide-react";
import { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Visualizador de imagem em modal. Portal no <body> pra a imagem não ficar
 * presa ao overflow das colunas do Inbox, e fechamento por Esc, clique no
 * fundo ou no X — as três formas que a pessoa vai tentar por instinto.
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
  const handleKey = useCallback(
    (event: KeyboardEvent) => {
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
    [onClose],
  );

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
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 p-4 duration-200 animate-in fade-in supports-backdrop-filter:backdrop-blur-sm"
    >
      <div className="absolute top-3 right-3 flex items-center gap-1">
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

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[88vh] max-w-full rounded-md object-contain shadow-2xl duration-200 ease-out animate-in zoom-in-95"
      />
    </div>,
    document.body,
  );
}
