/**
 * O que mudou entre a lista na tela e a primeira página que o servidor
 * acabou de devolver.
 *
 * Serve à primeira conexão do socket: a lista já veio pronta junto com o
 * HTML, e o socket só conecta um instante depois. O que chegou nesse
 * intervalo não passa pelo socket, então alguém precisa conferir — mas
 * conferir é UMA página da lista, e não lista, contadores e conversa
 * aberta de novo, como numa reconexão de verdade. Quase sempre nada
 * mudou, e aí mais nada é buscado.
 *
 * Compara posição a posição: conversa nova no topo, uma que saiu do
 * recorte ou que só trocou de lugar desalinham a sequência, e qualquer
 * campo diferente (mensagem nova, não lidas, dono) muda o conteúdo.
 */
export function conferirPrimeiraPagina<T extends { id: string }>(
  naTela: readonly T[],
  doServidor: readonly T[],
): { mudou: boolean; mudaram: Set<string> } {
  const mudaram = new Set<string>();
  const porId = new Map(naTela.map((item) => [item.id, item] as const));

  let mudou = false;
  doServidor.forEach((item, posicao) => {
    const naMesmaPosicao = naTela[posicao];
    if (naMesmaPosicao?.id !== item.id) mudou = true;

    const anterior = porId.get(item.id);
    if (!anterior || JSON.stringify(anterior) !== JSON.stringify(item)) {
      mudou = true;
      mudaram.add(item.id);
    }
  });

  return { mudou, mudaram };
}
