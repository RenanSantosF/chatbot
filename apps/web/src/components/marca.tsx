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
 * SEM A PLACA ATRÁS, e essa foi a mudança que faltava.
 *
 * O símbolo era um quadrado verde arredondado com o balão branco dentro —
 * duas formas empilhadas pra dizer uma coisa só. No topo da barra lateral
 * isso virava um bloco de cor sólida competindo com o menu logo abaixo, e
 * o desenho em si ficava espremido no miolo. Agora a marca É o balão, e o
 * fundo é o da barra: a silhueta fica reconhecível, e o topo para de
 * parecer um botão que dá pra apertar.
 *
 * Os pontos e o brilho são VAZADOS em vez de pintados: em branco eles
 * fixariam um fundo claro dentro de um símbolo transparente, e a marca
 * deixaria de acompanhar o tema.
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
        <linearGradient id="marca-verde" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#10A46C" />
          <stop offset="1" stopColor="#006F58" />
        </linearGradient>
        <mask id="marca-vazado">
          <rect width="1024" height="1024" fill="#fff" />
          <circle cx="360" cy="448" r="58" fill="#000" />
          <circle cx="512" cy="448" r="58" fill="#000" />
          <path
            d="M700 356 Q718 430 792 448 Q718 466 700 540 Q682 466 608 448 Q682 430 700 356 Z"
            fill="#000"
          />
        </mask>
      </defs>
      <g fill="url(#marca-verde)" mask="url(#marca-vazado)">
        <rect x="96" y="160" width="832" height="576" rx="168" />
        {/* O rabicho, alinhado à esquerda como num balão de fala. */}
        <path d="M300 690 L300 920 L488 712 Z" />
      </g>
    </svg>
  );
}
