import * as React from "react";

// O `xl` do Tailwind: a largura a partir da qual a terceira coluna do
// Inbox (a ficha do cliente) cabe na tela.
const QUERY = "(min-width: 1280px)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * Se a tela é larga o bastante pra mostrar a ficha do cliente.
 *
 * Esconder por CSS não bastava: escondida, a ficha continuava montada e
 * buscando anotações e tarefas a cada conversa aberta — duas chamadas por
 * clique pra algo que ninguém via. O servidor assume a tela larga, que é
 * o padrão do painel (mesma lógica de `useIsMobile`).
 */
export function useTelaLarga() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true,
  );
}
