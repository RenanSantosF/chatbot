import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

/**
 * Lê a largura da tela pelo useSyncExternalStore em vez de um efeito que
 * chama setState: assim o primeiro render no cliente já sai com o valor
 * certo (sem um quadro na largura errada) e o servidor renderiza a versão
 * de desktop, que é o padrão do painel.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
