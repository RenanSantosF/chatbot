import sharp from 'sharp';
import { CacheDeMiniaturas, gerarMiniatura, larguraPedida } from './miniatura';

/** Uma "foto de celular": grande e com ruído, pra não comprimir a quase nada. */
async function fotoGrande(largura = 2000, altura = 1500) {
  const ruido = Buffer.alloc(largura * altura * 3);
  for (let i = 0; i < ruido.length; i += 1) ruido[i] = (i * 2654435761) % 251;
  return sharp(ruido, { raw: { width: largura, height: altura, channels: 3 } })
    .jpeg({ quality: 85 })
    .toBuffer();
}

describe('miniatura da foto do chat', () => {
  it('reduz a foto à largura do balão, em WebP e bem menor', async () => {
    const original = await fotoGrande();
    const mini = await gerarMiniatura(
      { buffer: original, mimeType: 'image/jpeg' },
      640,
    );

    expect(mini?.mimeType).toBe('image/webp');
    const { width } = await sharp(mini!.buffer).metadata();
    expect(width).toBe(640);
    expect(mini!.buffer.length).toBeLessThan(original.length / 3);
  });

  it('não mexe em figurinha, GIF nem documento', async () => {
    const qualquer = { buffer: Buffer.from('x') };
    for (const mimeType of ['image/webp', 'image/gif', 'application/pdf']) {
      await expect(
        gerarMiniatura({ ...qualquer, mimeType }, 640),
      ).resolves.toBeNull();
    }
  });

  it('só aceita as larguras previstas', () => {
    expect(larguraPedida('640')).toBe(640);
    expect(larguraPedida('320')).toBe(320);
    expect(larguraPedida('1')).toBeNull();
    expect(larguraPedida(undefined)).toBeNull();
  });
});

describe('CacheDeMiniaturas', () => {
  const item = (bytes: number) => ({
    buffer: Buffer.alloc(bytes),
    mimeType: 'image/webp',
  });

  it('tira o menos usado quando passa do teto', () => {
    const cache = new CacheDeMiniaturas(100);
    cache.set('a', item(40));
    cache.set('b', item(40));
    cache.get('a'); // "a" passa a ser o mais recente
    cache.set('c', item(40));

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
  });
});
