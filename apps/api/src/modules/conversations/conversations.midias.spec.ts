import { ConversationsService } from './conversations.service';

/**
 * A galeria da conversa: o recorte certo em cada aba, as contagens de
 * todas numa ida só, e nada apagado.
 */
function montar(pagina: { id: string }[] = []) {
  const findMany = jest.fn().mockResolvedValue(pagina);
  const count = jest.fn().mockResolvedValue(3);
  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'conversa-1' }),
      },
      message: { findMany, count },
    },
  };
  const service = new ConversationsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { get: jest.fn().mockResolvedValue({ queueVisibility: 'ALL' }) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, findMany, count };
}

type Chamada = [{ where: Record<string, unknown>; take: number }];

describe('galeria da conversa', () => {
  it('mídia é foto e vídeo, sem apagadas', async () => {
    const { service, findMany } = montar();

    await service.listarMidias('conversa-1');

    const [[{ where }]] = findMany.mock.calls as Chamada[];
    expect(where).toMatchObject({
      conversationId: 'conversa-1',
      deletedAt: null,
      messageType: { in: ['IMAGE', 'VIDEO'] },
      // Figurinha (WebP) não entra na grade.
      NOT: {
        metadata: { path: ['mimeType'], string_starts_with: 'image/webp' },
      },
    });
  });

  it('links são textos com endereço', async () => {
    const { service, findMany } = montar();

    await service.listarMidias('conversa-1', { tipo: 'LINK' });

    const [[{ where }]] = findMany.mock.calls as Chamada[];
    expect(where).toMatchObject({
      messageType: 'TEXT',
      content: { contains: 'http', mode: 'insensitive' },
    });
  });

  it('tipo desconhecido cai em mídia, e as quatro contagens vêm juntas', async () => {
    const { service, count } = montar();

    const resposta = await service.listarMidias('conversa-1', {
      tipo: 'QUALQUER',
    });

    expect(resposta.tipo).toBe('MIDIA');
    expect(count).toHaveBeenCalledTimes(4);
    expect(resposta.contagens).toEqual({
      MIDIA: 3,
      DOCUMENTO: 3,
      AUDIO: 3,
      LINK: 3,
    });
  });

  it('pagina pelo cursor e avisa quando há mais', async () => {
    const itens = Array.from({ length: 3 }, (_, i) => ({ id: `m${i}` }));
    const { service } = montar(itens);

    const resposta = await service.listarMidias('conversa-1', { limit: 2 });

    expect(resposta.items).toHaveLength(2);
    expect(resposta.nextCursor).toBe('m1');
  });
});
