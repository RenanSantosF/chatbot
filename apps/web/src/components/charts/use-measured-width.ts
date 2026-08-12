"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Largura real do container, pra desenhar o SVG em pixels de verdade. Sem
 * isso teríamos que escalar um viewBox fixo, o que engorda/afina os traços
 * e o texto conforme a tela — justamente o que faz gráfico parecer amador.
 */
export function useMeasuredWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? 0;
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
