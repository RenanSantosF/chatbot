import { ConversationsService, notaDaAvaliacao } from './conversations.service';

describe('a nota na resposta do cliente', () => {
  it.each([
    ['5', 5],
    ['4.', 4],
    ['nota 3', 3],
    ['4/5', 4],
    ['5 estrelas', 5],
    ['⭐⭐⭐⭐', 4],
    ['Cinco!', 5],
    ['três', 3],
  ])('"%s" é nota %i', (texto, nota) => {
    expect(notaDaAvaliacao(texto)).toBe(nota);
  });

  it.each([
    '6',
    '0',
    '5 minutos e chego',
    '1 dúvida',
    'obrigado',
    '⭐⭐⭐⭐⭐⭐',
  ])('"%s" não é nota', (texto) => {
    expect(notaDaAvaliacao(texto)).toBeNull();
  });
});

describe('pedir e registrar a avaliação', () => {
  function montar(opcoes: { ativa: boolean; pedidaHa?: number | null }) {
    const criadas: Record<string, unknown>[] = [];
    const avaliacoes: Record<string, unknown>[] = [];
    const conversa = {
      id: 'c1',
      channel: 'WHATSAPP',
      status: 'RESOLVED',
      assignedUserId: 'ana',
      customer: { isGroup: false },
      messages: [],
      tags: [],
    };
    const prisma = {
      tenantId: 't1',
      db: {
        conversation: {
          findFirst: jest.fn((args: { where?: Record<string, unknown> }) =>
            Promise.resolve(
              args?.where && 'avaliacaoPedidaEm' in args.where
                ? opcoes.pedidaHa === null
                  ? null
                  : conversa
                : conversa,
            ),
          ),
          update: jest.fn().mockResolvedValue(conversa),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        message: {
          create: jest.fn((args: { data: Record<string, unknown> }) => {
            criadas.push(args.data);
            return { id: `m${criadas.length}`, ...args.data };
          }),
        },
        avaliacaoDeAtendimento: {
          create: jest.fn((args: { data: Record<string, unknown> }) => {
            avaliacoes.push(args.data);
            return args.data;
          }),
        },
      },
    };
    const inboxSettings = {
      get: jest.fn().mockResolvedValue({
        avaliacaoAtiva: opcoes.ativa,
        avaliacaoMensagem: 'De 1 a 5, que nota você dá?',
        notifyOnResolve: false,
        resolveMessage: '',
      }),
    };
    const service = new ConversationsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      inboxSettings as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const persistMessage = jest.fn().mockResolvedValue({
      conversation: conversa,
      message: {},
    });
    Object.assign(service as unknown as Record<string, unknown>, {
      persistMessage,
      emitirParaConversaId: jest.fn(),
      emitirParaConversa: jest.fn(),
      requireConversationExists: jest.fn(),
    });
    return { service, persistMessage, avaliacoes, criadas, prisma };
  }

  it('desligada (o padrão): encerrar não pergunta nada', async () => {
    const { service, persistMessage } = montar({ ativa: false });

    await service.resolve('c1');

    expect(persistMessage).not.toHaveBeenCalled();
  });

  it('ligada: encerrar manda a pergunta sem mexer no estado', async () => {
    const { service, persistMessage, prisma } = montar({ ativa: true });

    await service.resolve('c1');

    expect(persistMessage).toHaveBeenCalledWith('c1', {
      senderType: 'AGENT',
      content: 'De 1 a 5, que nota você dá?',
      automatica: true,
    });
    expect(prisma.db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { avaliacaoPedidaEm: expect.any(Date) as Date },
    });
  });

  it('o "5" do cliente vira nota, sem reabrir a conversa', async () => {
    const { service, avaliacoes, criadas } = montar({ ativa: true });

    const resultado = await (
      service as unknown as {
        registrarAvaliacao: (
          id: string,
          input: { content: string },
        ) => Promise<unknown>;
      }
    ).registrarAvaliacao('cliente-1', { content: '5' });

    expect(resultado).not.toBeNull();
    expect(avaliacoes).toEqual([
      expect.objectContaining({ nota: 5, atendenteId: 'ana' }),
    ]);
    expect(criadas[0]).toMatchObject({ senderType: 'CUSTOMER', content: '5' });
  });

  it('sem pergunta pendente, o "5" é uma mensagem como outra qualquer', async () => {
    const { service, avaliacoes } = montar({ ativa: true, pedidaHa: null });

    const resultado = await (
      service as unknown as {
        registrarAvaliacao: (
          id: string,
          input: { content: string },
        ) => Promise<unknown>;
      }
    ).registrarAvaliacao('cliente-1', { content: '5' });

    expect(resultado).toBeNull();
    expect(avaliacoes).toHaveLength(0);
  });
});
