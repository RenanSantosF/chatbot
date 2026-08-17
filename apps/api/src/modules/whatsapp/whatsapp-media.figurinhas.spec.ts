import { WhatsappMediaService } from './whatsapp-media.service';

/**
 * Quais mensagens viram figurinha no seletor do compositor.
 *
 * O recorte é feito em duas etapas por um motivo de custo: o banco devolve
 * as mensagens de IMAGEM com mídia (que usa índice), e o WebP é conferido
 * aqui, em memória — o mimetype mora dentro do JSON de metadados, e
 * filtrar por caminho de Json varreria a maior tabela do sistema.
 *
 * O que se testa é justamente a segunda etapa, que é onde dá pra errar
 * calado: uma foto comum aparecendo entre as figurinhas, ou a mesma
 * figurinha repetida vinte vezes porque foi mandada vinte vezes.
 */
function montar(mensagens: { mediaId: string | null; mimeType?: string }[]) {
  const findMany = jest.fn().mockResolvedValue(
    mensagens.map((m) => ({
      mediaId: m.mediaId,
      metadata: m.mimeType ? { mimeType: m.mimeType } : null,
    })),
  );

  const prisma = { tenantId: 't', db: { message: { findMany } } };
  const service = new WhatsappMediaService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, findMany };
}

const FIGURINHA = 'image/webp';
const FOTO = 'image/jpeg';

describe('as figurinhas que já passaram pela conta', () => {
  it('só WebP entra — foto comum fica de fora', async () => {
    const { service } = montar([
      { mediaId: 'a', mimeType: FIGURINHA },
      { mediaId: 'b', mimeType: FOTO },
      { mediaId: 'c', mimeType: FIGURINHA },
    ]);

    expect(await service.figurinhas()).toEqual([
      { mediaId: 'a' },
      { mediaId: 'c' },
    ]);
  });

  it('a mesma figurinha mandada dez vezes aparece uma vez', async () => {
    // É o caso comum: figurinha de atendimento é sempre a mesma meia
    // dúzia, e sem isto o seletor mostraria dez cópias do mesmo joinha.
    const { service } = montar([
      { mediaId: 'a', mimeType: FIGURINHA },
      { mediaId: 'a', mimeType: FIGURINHA },
      { mediaId: 'b', mimeType: FIGURINHA },
    ]);

    expect(await service.figurinhas()).toEqual([
      { mediaId: 'a' },
      { mediaId: 'b' },
    ]);
  });

  it('mensagem sem mimetype gravado não vira figurinha', async () => {
    // Metadata é Json e pode vir sem nada. Tratar ausência como WebP
    // encheria o seletor de anexos que não são figurinha nenhuma.
    const { service } = montar([{ mediaId: 'a' }]);

    expect(await service.figurinhas()).toEqual([]);
  });

  it('respeita o teto pedido', async () => {
    const { service } = montar(
      Array.from({ length: 10 }, (_, i) => ({
        mediaId: `s${i}`,
        mimeType: FIGURINHA,
      })),
    );

    expect(await service.figurinhas(3)).toHaveLength(3);
  });

  it('pede ao banco só imagem com mídia e não apagada', async () => {
    const { service, findMany } = montar([]);

    await service.figurinhas();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          messageType: 'IMAGE',
          mediaId: { not: null },
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });
});
