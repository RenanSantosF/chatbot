/**
 * Altura da miniatura em relação à largura: a da própria foto, presa
 * entre paisagem 4:3 e retrato 4:5.
 *
 * Fora dessa faixa a miniatura deixa de ser útil — um panorama vira uma
 * risca e um print de conversa vira uma coluna. O corte mostra o miolo, e
 * o clique abre o resto.
 */
export function proporcaoDaMiniatura(largura: number, altura: number): number {
  if (!largura || !altura) return 1;
  return Math.min(Math.max(altura / largura, 0.75), 1.25);
}
