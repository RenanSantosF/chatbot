import type { MessageType } from "@/lib/types";

/** Prévia de mídia, no espírito do "📷 Foto" do WhatsApp. */
const MEDIA_PREVIEW: Record<string, string> = {
  IMAGE: "Imagem",
  AUDIO: "Áudio",
  VIDEO: "Vídeo",
  DOCUMENT: "Documento",
  LOCATION: "Localização",
  OTHER: "Anexo",
};

/**
 * Uma linha que descreve a mensagem quando ela não é texto.
 *
 * Existe num lugar só porque são dois consumidores que precisam concordar:
 * a prévia na lista de conversas e o corpo da notificação do navegador.
 * Enquanto o mapa vivia dentro da lista, a notificação de uma foto chegava
 * com o corpo VAZIO — `content` de anexo costuma ser string vazia, e um
 * balão de notificação sem texto parece defeito do sistema.
 *
 * Uma figurinha continua caindo em "Imagem": ela chega como WebP e o
 * `messageType` não a distingue de uma foto. Errar pra "Imagem" é o lado
 * certo de errar — o contrário seria chamar toda foto de figurinha.
 */
export function resumoDaMensagem(
  content: string,
  messageType: MessageType,
): string {
  if (messageType === "TEXT") return content;

  const rotulo = MEDIA_PREVIEW[messageType] ?? "Anexo";
  // A legenda, quando existe, diz mais que o rótulo: "Imagem · segue o
  // orçamento" é mais útil que "Imagem" sozinho.
  const legenda = content.trim();
  return legenda ? `${rotulo} · ${legenda}` : rotulo;
}
