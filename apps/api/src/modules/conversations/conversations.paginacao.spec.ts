import { ConversationsService } from './conversations.service';

/**
 * O histórico do aparelho mudou o peso destas consultas.
 *
 * Quarenta e quatro mil mensagens importadas transformam qualquer leitura
 * sem limite num problema real: uma conversa de anos passa a ter milhares
 * de linhas, e o que antes era desperdício invisível vira tela travada.
 */
function montar() {
  const conversa = {
    id: 'conversa-1',
    channel: 'WHATSAPP',
    assignedUserId: 'user-1',
    customer: { id: 'cliente-1', phone: '5527999998888', name: 'Ana' },
  };

  const consultas: { modelo: string; args: Record<string, unknown> }[] = [];

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        findFirst: jest.fn().mockImplementation((args: Record<string, unknown>) => {
          consultas.push({ modelo: 'conversation', args });
          return { ...conversa, messages: [], tags: [] };
        }),
        // `toSummary` lê a prévia, então a linha devolvida precisa ter a
        // forma de uma conversa de verdade.
        update: jest.fn().mockResolvedValue({ ...conversa, messages: [], tags: [] }),
      },
      message: {
        findMany: jest.fn().mockImplementation((args: Record<string, unknown>) => {
          consultas.push({ modelo: 'message', args });
          return [];
        }),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    },
  };

  const service = new ConversationsService(
    prisma as never,
    {} as never,
    { emitToTenant: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    { get: jest.fn().mockResolvedValue({}) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { registrar: jest.fn() } as never,
  );

  return { service, consultas, prisma };
}

describe('abrir a conversa', () => {
  it('traz só uma página de mensagens, não o histórico inteiro', async () => {
    const { service, consultas } = montar();

    await service.getById('conversa-1');

    const leitura = consultas.find((c) => c.modelo === 'message');
    expect(leitura?.args.take).toBeDefined();
    expect(Number(leitura?.args.take)).toBeLessThanOrEqual(101);
  });

  it('não carrega o histórico junto da conversa', async () => {
    // O `include` chega a trazer mensagem, mas só UMA: a última, que é a
    // prévia da lista. O que não pode voltar é a leitura sem limite.
    const { service, consultas } = montar();

    await service.getById('conversa-1');

    const daConversa = consultas.find((c) => c.modelo === 'conversation');
    const include = daConversa?.args.include as { messages?: { take?: number } };
    expect(include?.messages?.take).toBe(1);
  });
});

describe('operações que não leem mensagem', () => {
  it('mudar a prioridade não arrasta o histórico junto', async () => {
    // Nenhum desses chamadores lê uma linha do que vinha — e com o
    // histórico do aparelho importado, cada um deles puxava milhares de
    // linhas do banco pra jogar fora.
    const { service, consultas } = montar();

    await service.setPriority('conversa-1', 'HIGH');

    for (const consulta of consultas.filter((c) => c.modelo === 'conversation')) {
      const include = consulta.args.include as
        | { messages?: { take?: number } }
        | undefined;
      // Ou não pede mensagem, ou pede a prévia — nunca o histórico solto.
      if (include?.messages) expect(include.messages.take).toBe(1);
    }
  });
});
