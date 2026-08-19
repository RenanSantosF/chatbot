import { ConversationsService } from './conversations.service';

/**
 * As conversas que já estavam no aparelho, sem virem em dobro.
 *
 * O aparelho despeja o histórico em lotes que se SOBREPÕEM, e vários
 * chegam no mesmo segundo. Foi assim que uma reconexão duplicou a
 * conversa inteira no painel: cada lote conferia "já tenho?", todos liam
 * que não, e todos gravavam.
 *
 * Os três testes daqui cobrem as três formas de a mesma mensagem entrar
 * duas vezes: repetida dentro do lote, repetida entre lotes, e as duas
 * gravações correndo juntas — esta última só o banco resolve.
 */
function montar(
  jaGravadas: (string | { externalId: string; metadata?: unknown })[] = [],
) {
  const criadas: { data: Record<string, unknown>[]; skipDuplicates?: boolean }[] =
    [];

  const db = {
    // A busca da conversa acontece dentro de uma transação com trava por
    // cliente (ver `conversaDoHistorico`); o `tx` é este mesmo objeto.
    $transaction: jest.fn((executar: (tx: unknown) => unknown) => executar(db)),
    $executeRaw: jest.fn().mockResolvedValue(1),
    conversation: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'conversa-1',
        lastMessageAt: null,
      }),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'conversa-1' }),
    },
    message: {
      findMany: jest.fn().mockResolvedValue(
        jaGravadas.map((m, i) =>
          typeof m === 'string'
            ? { id: `msg-${i}`, externalId: m, metadata: null }
            : { id: `msg-${i}`, metadata: null, ...m },
        ),
      ),
      update: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockImplementation((args) => {
        criadas.push(args);
        return { count: (args.data as unknown[]).length };
      }),
    },
  };

  const prisma = { tenantId: 'tenant-teste', db };

  const customers = {
    upsertFromAddressBook: jest.fn().mockResolvedValue({ id: 'cliente-1' }),
  };

  const service = new ConversationsService(
    prisma as never,
    customers as never,
    { emitToTenant: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { registrar: jest.fn() } as never,
  );

  return { service, prisma, criadas };
}

function linha(externalId: string) {
  return {
    daEmpresa: false,
    content: 'bom dia',
    externalId,
    createdAt: new Date('2026-08-19T12:00:00Z'),
  };
}

describe('importação do histórico', () => {
  it('a mensagem repetida DENTRO do lote entra uma vez só', async () => {
    // A janela de um lote se sobrepõe à do seguinte, e a mesma mensagem
    // vem duas vezes no mesmo evento. A conferência contra o banco não
    // pega este caso: as duas cópias chegam juntas.
    const { service, criadas } = montar();

    const gravadas = await service.importarHistorico({
      customerPhone: '5527999998888',
      mensagens: [linha('chave-a'), linha('chave-a'), linha('chave-b')],
    });

    expect(criadas[0].data).toHaveLength(2);
    expect(gravadas).toBe(2);
  });

  it('não regrava o que o lote anterior já trouxe', async () => {
    const { service, criadas } = montar(['chave-a']);

    await service.importarHistorico({
      customerPhone: '5527999998888',
      mensagens: [linha('chave-a'), linha('chave-b')],
    });

    expect(criadas[0].data).toEqual([
      expect.objectContaining({ externalId: 'chave-b' }),
    ]);
  });

  it('deixa a última palavra com o índice único do banco', async () => {
    /*
     * Tudo o que vem antes é ler e depois escrever — e dois lotes
     * simultâneos leem "não tem" ao mesmo tempo. `skipDuplicates` é a
     * única parte que não é uma corrida.
     */
    const { service, criadas } = montar();

    await service.importarHistorico({
      customerPhone: '5527999998888',
      mensagens: [linha('chave-a')],
    });

    expect(criadas[0].skipDuplicates).toBe(true);
  });

  it('completa o endereço do anexo antigo, sem reescrever quem já o tem', async () => {
    /*
     * As mensagens importadas antes desta mudança foram gravadas só com a
     * chave, e a chave sozinha não abre anexo de conversa que já estava
     * no aparelho. O aparelho remanda o histórico a cada pareamento, e é
     * essa segunda passagem que conserta as antigas.
     */
    const { service, prisma } = montar([
      { externalId: 'chave-a', metadata: { mimeType: 'image/jpeg' } },
      {
        externalId: 'chave-b',
        metadata: { evolutionMedia: { imageMessage: { url: 'já tinha' } } },
      },
    ]);

    await service.importarHistorico({
      customerPhone: '5527999998888',
      mensagens: [
        {
          ...linha('chave-a'),
          metadata: { evolutionMedia: { imageMessage: { url: 'novo' } } },
        },
        {
          ...linha('chave-b'),
          metadata: { evolutionMedia: { imageMessage: { url: 'novo' } } },
        },
      ],
    });

    expect(prisma.db.message.update).toHaveBeenCalledTimes(1);
    expect(prisma.db.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          metadata: {
            mimeType: 'image/jpeg',
            evolutionMedia: { imageMessage: { url: 'novo' } },
          },
        },
      }),
    );
  });

  it('não escreve nada quando o lote não traz endereço de mídia', async () => {
    const { service, prisma } = montar(['chave-a']);

    await service.importarHistorico({
      customerPhone: '5527999998888',
      mensagens: [linha('chave-a')],
    });

    expect(prisma.db.message.update).not.toHaveBeenCalled();
  });

  it('trava por cliente antes de procurar a conversa', async () => {
    /*
     * Sem a trava, dois lotes do mesmo contato chegando juntos não achavam
     * conversa nenhuma e criavam uma cada: o cliente aparecia duas vezes
     * na lista, com metade do histórico em cada.
     */
    const { service, prisma } = montar();
    prisma.db.conversation.findFirst.mockResolvedValue(null);
    prisma.db.conversation.create.mockResolvedValue({
      id: 'conversa-nova',
      lastMessageAt: null,
    });

    await service.importarHistorico({
      customerPhone: '5527999998888',
      mensagens: [linha('chave-a')],
    });

    expect(prisma.db.$executeRaw).toHaveBeenCalled();
    expect(prisma.db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.db.conversation.findFirst.mock.invocationCallOrder[0],
    );
    expect(prisma.db.conversation.create).toHaveBeenCalledTimes(1);
  });

  it('conta o que o banco gravou, não o que foi tentado', async () => {
    // O número vira a contagem de "trazidas até agora" na tela. Contar as
    // puladas fazia o painel anunciar milhares de mensagens inexistentes.
    const { service, prisma } = montar();
    prisma.db.message.createMany.mockResolvedValue({ count: 1 });

    const gravadas = await service.importarHistorico({
      customerPhone: '5527999998888',
      mensagens: [linha('chave-a'), linha('chave-b')],
    });

    expect(gravadas).toBe(1);
  });
});
