import {
  ConversationsService,
  LIMITE_DO_HISTORICO_IMPORTADO,
} from './conversations.service';
import { abrirHistoricoGuardado } from './historico-guardado';

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
  /** A 40ª mensagem mais recente que a conversa já tem, se tiver 40. */
  corteDaCapa: Date | null = null,
  /** A mais recente que a conversa já tem. */
  ultimaGravada: Date | null = corteDaCapa,
) {
  const criadas: {
    data: Record<string, unknown>[];
    skipDuplicates?: boolean;
  }[] = [];
  // O bloco guardado da conversa, como o banco o teria.
  let guardado: { mensagens: unknown; updatedAt: Date } | null = null;

  // Com `skip` é o corte da capa; sem, a mais recente da conversa.
  const findFirst = jest.fn((args: { skip?: number }) => {
    const data = args.skip ? corteDaCapa : ultimaGravada;
    return Promise.resolve(data ? { createdAt: data } : null);
  });

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
      findFirst,
      findMany: jest
        .fn()
        .mockResolvedValue(
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
    historicoGuardado: {
      findUnique: jest.fn(() => Promise.resolve(guardado)),
      upsert: jest.fn(
        (args: {
          create: { mensagens: unknown };
          update: { mensagens: unknown };
        }) => {
          guardado = {
            mensagens: JSON.parse(
              JSON.stringify(args.update.mensagens),
            ) as unknown,
            updatedAt: new Date(),
          };
          return Promise.resolve({});
        },
      ),
      deleteMany: jest.fn(() => {
        guardado = null;
        return Promise.resolve({ count: 1 });
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
    { avisarEquipe: jest.fn().mockResolvedValue(undefined) } as never,
  );

  /** O que ficou no bloco guardado, pelo id externo. */
  const noBloco = () =>
    ((guardado?.mensagens ?? []) as { externalId: string }[]).map(
      (m) => m.externalId,
    );
  /** Tudo que a importação guardou: a capa e o bloco. */
  const tudo = () => [
    ...criadas.flatMap((c) => c.data.map((m) => m.externalId)),
    ...noBloco(),
  ];

  return { service, prisma, criadas, noBloco, tudo, findFirst };
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
    const { service, tudo } = montar();

    const gravadas = await service.importarHistorico({
      customerPhone: '5527999998888',
      mensagens: [linha('chave-a'), linha('chave-a'), linha('chave-b')],
    });

    expect(tudo().sort()).toEqual(['chave-a', 'chave-b']);
    expect(gravadas.importadas).toBe(2);
  });

  it('não regrava o que o lote anterior já trouxe', async () => {
    const { service, tudo } = montar(['chave-a']);

    await service.importarHistorico({
      customerPhone: '5527999998888',
      mensagens: [linha('chave-a'), linha('chave-b')],
    });

    expect(tudo()).toEqual(['chave-b']);
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
    // Aqui, a capa que o índice único pulou (outro lote a gravou no mesmo
    // segundo) não conta; a que foi pro bloco, sim.
    const { service, prisma } = montar();
    prisma.db.message.createMany.mockResolvedValue({ count: 0 });

    const gravadas = await service.importarHistorico({
      customerPhone: '5527999998888',
      mensagens: [
        linha('chave-a'),
        { ...linha('chave-b'), createdAt: new Date('2026-08-20T12:00:00Z') },
      ],
    });

    expect(gravadas.importadas).toBe(1);
  });

  it('grava só a capa como mensagem, e guarda as últimas trocas de lado', async () => {
    const { service, criadas, noBloco } = montar();
    const mensagens = Array.from({ length: 100 }, (_, i) => ({
      ...linha(`chave-${i}`),
      createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
    }));

    await service.importarHistorico({
      customerPhone: '5527999998888',
      mensagens,
    });

    // Na tabela de mensagens, só a mais nova — é ela que a lista mostra.
    expect(criadas).toHaveLength(1);
    expect(criadas[0].data.map((m) => m.externalId)).toEqual(['chave-99']);
    // No bloco, as seguintes até o teto, e nenhuma das antigas.
    expect(noBloco()).toHaveLength(LIMITE_DO_HISTORICO_IMPORTADO - 1);
    expect(noBloco()[0]).toBe('chave-98');
    expect(noBloco()).not.toContain('chave-0');
  });

  it('conversa que já tem a capa só recebe o que for mais novo que ela', async () => {
    const corte = new Date('2026-08-19T12:00:00Z');
    const { service, tudo } = montar([], corte);

    await service.importarHistorico({
      customerPhone: '5527999998888',
      mensagens: [
        { ...linha('antiga'), createdAt: new Date('2026-08-01T12:00:00Z') },
        { ...linha('nova'), createdAt: new Date('2026-08-20T12:00:00Z') },
      ],
    });

    expect(tudo()).toEqual(['nova']);
  });

  it('não troca a capa por uma mensagem mais velha que a da lista', async () => {
    // A conversa já recebeu mensagem ao vivo depois deste lote: ela é a
    // capa, e o lote inteiro vai pro bloco.
    const { service, criadas, noBloco } = montar(
      [],
      null,
      new Date('2026-09-01T12:00:00Z'),
    );

    await service.importarHistorico({
      customerPhone: '5527999998888',
      mensagens: [linha('chave-a')],
    });

    expect(criadas).toHaveLength(0);
    expect(noBloco()).toEqual(['chave-a']);
  });

  it('lote repetido junta com o bloco, sem duplicar nem contar de novo', async () => {
    const { service, findFirst, noBloco } = montar();
    const lote = [
      linha('chave-a'),
      { ...linha('chave-b'), createdAt: new Date('2026-08-18T12:00:00Z') },
      { ...linha('chave-c'), createdAt: new Date('2026-08-20T12:00:00Z') },
    ];

    await service.importarHistorico({
      customerPhone: '5527999998888',
      mensagens: lote,
    });
    // Agora o banco tem a capa (chave-c) como a mais recente da conversa.
    findFirst.mockImplementation((args: { skip?: number }) =>
      Promise.resolve(
        args.skip ? null : { createdAt: new Date('2026-08-20T12:00:00Z') },
      ),
    );
    const segunda = await service.importarHistorico({
      customerPhone: '5527999998888',
      // A capa (chave-c) o banco já tem; o resto é o bloco de novo.
      mensagens: lote.filter((m) => m.externalId !== 'chave-c'),
    });

    expect(noBloco()).toEqual(['chave-a', 'chave-b']);
    expect(segunda).toEqual({ importadas: 0, conversationId: null });
  });
});

describe('abrir o histórico guardado', () => {
  function montarAbertura(guardado: unknown) {
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      tenantId: 'tenant-teste',
      db: {
        message: { createMany },
        historicoGuardado: {
          findUnique: jest.fn().mockResolvedValue(guardado),
          deleteMany,
        },
      },
    };
    return { prisma, createMany, deleteMany };
  }

  it('vira mensagem de verdade e sai do bloco', async () => {
    const versao = new Date('2026-09-29T10:00:00Z');
    const { prisma, createMany, deleteMany } = montarAbertura({
      updatedAt: versao,
      mensagens: [
        {
          externalId: 'chave-b',
          daEmpresa: true,
          content: 'pode sim',
          createdAt: '2026-08-19T12:01:00.000Z',
        },
        {
          externalId: 'chave-a',
          daEmpresa: false,
          content: 'posso passar aí?',
          createdAt: '2026-08-19T12:00:00.000Z',
        },
      ],
    });

    const abertas = await abrirHistoricoGuardado(prisma as never, 'conversa-1');

    expect(abertas).toBe(2);
    expect(createMany).toHaveBeenCalledWith({
      skipDuplicates: true,
      data: [
        expect.objectContaining({
          externalId: 'chave-b',
          senderType: 'AGENT',
          conversationId: 'conversa-1',
          tenantId: 'tenant-teste',
          createdAt: new Date('2026-08-19T12:01:00.000Z'),
        }),
        expect.objectContaining({
          externalId: 'chave-a',
          senderType: 'CUSTOMER',
        }),
      ],
    });
    // Só apaga a versão que leu: um lote que chegou no meio não se perde.
    expect(deleteMany).toHaveBeenCalledWith({
      where: { conversationId: 'conversa-1', updatedAt: versao },
    });
  });

  it('conversa sem nada guardado custa uma leitura e mais nada', async () => {
    const { prisma, createMany, deleteMany } = montarAbertura(null);

    await expect(
      abrirHistoricoGuardado(prisma as never, 'conversa-1'),
    ).resolves.toBe(0);
    expect(createMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
