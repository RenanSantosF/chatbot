import { createHash } from 'node:crypto';

/** SHA-256 do arquivo, em hexadecimal. */
export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * O `fileSha256` que o WhatsApp manda junto da mídia, venha como vier.
 *
 * É o hash do arquivo em si — o mesmo que calculamos ao guardar —, mas
 * atravessa o JSON da Evolution de três jeitos: texto em base64, o
 * `{ type: 'Buffer', data: [...] }` do Node, ou um objeto de índices
 * numéricos (Uint8Array serializado).
 */
function hashDoWhatsapp(bruto: unknown): string | null {
  if (typeof bruto === 'string' && bruto) {
    return Buffer.from(bruto, 'base64').toString('hex');
  }
  if (bruto && typeof bruto === 'object') {
    const dados = (bruto as { data?: unknown }).data;
    if (Array.isArray(dados))
      return Buffer.from(dados as number[]).toString('hex');
    const valores = Object.values(bruto as Record<string, unknown>);
    if (valores.length > 0 && valores.every((v) => typeof v === 'number')) {
      return Buffer.from(valores).toString('hex');
    }
  }
  return null;
}

/**
 * O que identifica o ARQUIVO, e não a mensagem.
 *
 * A mesma figurinha mandada dez vezes são dez mensagens, cada uma com o
 * seu `mediaId` — separar a lista por ele repetia a figurinha a cada
 * envio. O hash do conteúdo é igual nas dez. Ordem: o hash que gravamos
 * ao guardar ou enviar; o que o WhatsApp mandou; e, sem nenhum dos dois,
 * o próprio `mediaId` (aí não dá pra saber, e ela aparece uma vez por
 * mensagem, como antes).
 */
export function impressaoDigital(
  metadata: Record<string, unknown> | null | undefined,
  mediaId: string,
): string {
  const gravado = metadata?.conteudoSha256;
  if (typeof gravado === 'string' && gravado) return gravado;

  const midias = metadata?.evolutionMedia;
  if (midias && typeof midias === 'object') {
    for (const parte of Object.values(midias as Record<string, unknown>)) {
      const hash = hashDoWhatsapp(
        (parte as { fileSha256?: unknown } | null)?.fileSha256,
      );
      if (hash) return hash;
    }
  }
  return mediaId;
}
