import { SITE_NAME } from "@/lib/site";

/**
 * O símbolo da marca, em SVG inline.
 *
 * Inline e não <img>: ele aparece no cabeçalho de toda tela do painel, e
 * uma requisição a mais por navegação — mesmo em cache — é latência à toa
 * num elemento de 32 pixels. Inline ele chega junto com o HTML.
 *
 * O desenho é uma conversa que pensa: balão de fala com dois pontos de
 * digitação e um brilho no lugar do terceiro. Os dois primeiros dizem
 * "alguém está respondendo"; o terceiro diz quem.
 *
 * A versão de tamanho pequeno (favicon, aba do navegador) troca os três
 * elementos por um brilho só — em 16 pixels, três formas viram três
 * borrões. Ela vive em app/icon.svg.
 */
export function Marca({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      className={className}
      role="img"
      aria-label={SITE_NAME}
    >
      <defs>
        <linearGradient id="marca-fundo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#10A46C" />
          <stop offset="1" stopColor="#006F58" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="232" fill="url(#marca-fundo)" />
      <path d="M318 620 L318 812 L470 640 Z" fill="#fff" />
      <rect x="212" y="258" width="600" height="414" rx="112" fill="#fff" />
      <circle cx="340" cy="462" r="46" fill="#006F58" />
      <circle cx="502" cy="462" r="46" fill="#006F58" />
      <path
        d="M664 392 Q678 448 734 462 Q678 476 664 532 Q650 476 594 462 Q650 448 664 392 Z"
        fill="#006F58"
      />
    </svg>
  );
}
