/**
 * Agrupa uma rajada de chamadas numa execução só de `fn`, com um prazo
 * máximo que garante que ela roda mesmo se a rajada nunca parar.
 *
 * Existe pro histórico importado (ver F02): o webhook manda um lote a
 * cada poucos milissegundos numa sincronização grande, e reconciliar a
 * lista a cada lote deixaria o Inbox pesado bem na hora em que mais
 * precisa responder rápido. Duas janelas resolvem:
 *
 * - `janela`: reinicia a cada chamada de `disparar` — é o que junta uma
 *   rajada inteira numa reconciliação só, no fim dela.
 * - `prazoMaximo`: NÃO reinicia — é o que impede uma rajada contínua de
 *   adiar a atualização pra sempre. Sem ele, quem está olhando o Inbox
 *   importar nunca veria nada aparecer até o fim da sincronização
 *   inteira.
 */
export interface Agrupador {
  /** Reinicia a janela; roda `fn` se ninguém chamar de novo antes dela passar. */
  disparar: () => void;
  /** Roda `fn` já, cancelando o que estava agendado. */
  forcar: () => void;
  /** Desarma tudo sem rodar `fn`. */
  cancelar: () => void;
}

export function criarAgrupadorDeRajada(
  fn: () => void,
  opcoes: { janela: number; prazoMaximo: number },
): Agrupador {
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let maximo: ReturnType<typeof setTimeout> | null = null;

  const limpar = () => {
    if (debounce) {
      clearTimeout(debounce);
      debounce = null;
    }
    if (maximo) {
      clearTimeout(maximo);
      maximo = null;
    }
  };

  const forcar = () => {
    limpar();
    fn();
  };

  const disparar = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(forcar, opcoes.janela);
    // Não se recomeça: é o próprio ponto do prazo máximo.
    if (!maximo) {
      maximo = setTimeout(forcar, opcoes.prazoMaximo);
    }
  };

  return { disparar, forcar, cancelar: limpar };
}
