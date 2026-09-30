/**
 * Abrir a galeria de mídia da conversa aberta, de qualquer lugar.
 *
 * Quem desenha a galeria é o ChatPanel (é ele que sabe levar até a
 * mensagem na conversa), mas o atalho mais natural fica na ficha do
 * cliente, que é outro componente, em outra coluna. Um evento do
 * navegador liga os dois sem passar estado por quem não tem nada com isso.
 */
const EVENTO = "inteliwa:abrir-galeria";

export function abrirGaleria() {
  window.dispatchEvent(new Event(EVENTO));
}

export function aoAbrirGaleria(fazer: () => void): () => void {
  window.addEventListener(EVENTO, fazer);
  return () => window.removeEventListener(EVENTO, fazer);
}
