import sharp from 'sharp';

/**
 * Larguras de miniatura que a rota aceita.
 *
 * Fixas, e não "qualquer número": cada largura é uma versão guardada no
 * cache, e aceitar valor livre deixaria qualquer um encher a memória do
 * servidor pedindo `?w=1`, `?w=2`, `?w=3`... 640 é o balão do chat
 * (288px de largura) em tela de alta densidade.
 */
export const LARGURAS_DE_MINIATURA = [320, 640] as const;

export function larguraPedida(bruta: string | undefined): number | null {
  const largura = Number(bruta);
  return (LARGURAS_DE_MINIATURA as readonly number[]).includes(largura)
    ? largura
    : null;
}

/**
 * Só foto de verdade vira miniatura. GIF perderia a animação, e figurinha
 * (WebP) já é pequena e precisa da transparência intacta.
 */
const REDIMENSIONAVEIS = new Set(['image/jpeg', 'image/png']);

export interface Arquivo {
  buffer: Buffer;
  mimeType: string;
}

/**
 * A foto no tamanho em que o balão a desenha, em WebP.
 *
 * O balão mostra a foto com 288px de largura, e o navegador baixava a
 * original — do jeito que o WhatsApp entregou, frequentemente acima de 1500px.
 * Numa conversa com dez fotos, eram megabytes pra desenhar dez quadradinhos.
 * A original continua disponível sem `?w=`, pro visualizador em tela cheia.
 *
 * Devolve `null` quando não vale a pena: tipo que não se redimensiona, ou
 * miniatura que sairia maior que a própria original (foto já pequena).
 */
export async function gerarMiniatura(
  original: Arquivo,
  largura: number,
): Promise<Arquivo | null> {
  const tipo = original.mimeType.split(';')[0].trim().toLowerCase();
  if (!REDIMENSIONAVEIS.has(tipo)) return null;

  const buffer = await sharp(original.buffer)
    // Foto de celular vem deitada com a orientação no EXIF; sem `rotate`
    // a miniatura sairia de lado, e a original (que o navegador gira
    // sozinho) de pé.
    .rotate()
    .resize({ width: largura, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();

  return buffer.length < original.buffer.length
    ? { buffer, mimeType: 'image/webp' }
    : null;
}

/**
 * Cache das miniaturas já geradas, por tamanho total em bytes.
 *
 * Gerar custa CPU (dezenas de milissegundos por foto), e a mesma conversa
 * é aberta por várias pessoas da equipe ao longo do dia. O navegador de
 * cada uma guarda a sua cópia, mas o servidor refaria o trabalho pra cada
 * navegador novo. Sai sempre o mais antigo quando o teto enche.
 */
export class CacheDeMiniaturas {
  private readonly itens = new Map<string, Arquivo>();
  private bytes = 0;

  constructor(private readonly teto = 48 * 1024 * 1024) {}

  get(chave: string): Arquivo | undefined {
    const item = this.itens.get(chave);
    if (!item) return undefined;
    // Reinsere no fim: o que foi usado agora é o último a sair.
    this.itens.delete(chave);
    this.itens.set(chave, item);
    return item;
  }

  set(chave: string, item: Arquivo) {
    if (item.buffer.length > this.teto) return;
    const anterior = this.itens.get(chave);
    if (anterior) {
      this.bytes -= anterior.buffer.length;
      this.itens.delete(chave);
    }
    this.itens.set(chave, item);
    this.bytes += item.buffer.length;

    for (const [velha, valor] of this.itens) {
      if (this.bytes <= this.teto) break;
      this.itens.delete(velha);
      this.bytes -= valor.buffer.length;
    }
  }
}
