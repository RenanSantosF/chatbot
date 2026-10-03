import { AiUsageService, extrasQueSobraram } from './ai-usage.service';

/**
 * A cota mensal de respostas da IA.
 *
 * Existe porque a chave passou a ser da plataforma (ver
 * AiCredentialsResolver): quem paga o Google por cada resposta agora é a
 * Inteliwa, não mais a empresa. Sem teto, um bug de loop do lado do
 * cliente vira custo nosso sem fim.
 */
function montar(conta: Record<string, unknown> | null) {
  const criada = {
    id: 'billing-1',
    aiMonthlyMessageLimit: 3000,
    aiRepliesUsed: 0,
    aiInputTokensUsed: 0n,
    aiOutputTokensUsed: 0n,
    aiUsagePeriodStart: null,
    aiExtraMessagesThisPeriod: 0,
    aiCicloDia: null,
    createdAt: new Date('2026-08-15T15:00:00Z'),
    ...conta,
  };

  const update = jest.fn<typeof criada, [{ data: Record<string, unknown> }]>(
    (args) => ({
      ...criada,
      ...args.data,
      // Simula o `increment` do Prisma pros campos que o usam.
      ...(typeof args.data.aiRepliesUsed === 'object'
        ? {
            aiRepliesUsed:
              criada.aiRepliesUsed +
              (args.data.aiRepliesUsed as { increment: number }).increment,
          }
        : {}),
    }),
  );

  // A linha como está no banco: a virada do ciclo grava por `updateMany`
  // e relê, então o dublê precisa lembrar do que foi gravado.
  let atual: typeof criada | null = conta ? criada : null;
  const updateMany = jest.fn((args: { data: Record<string, unknown> }) => {
    atual = { ...(atual ?? criada), ...args.data };
    return { count: 1 };
  });

  const prisma = {
    tenantId: 'tenant-1',
    db: {
      billingAccount: {
        // `criada` (com os padrões) e não o `conta` cru: um teste que só
        // define os dois ou três campos que importa pra ele não deveria
        // precisar listar todos os outros só pra não virar `undefined`.
        findFirst: jest.fn(() => Promise.resolve(atual)),
        create: jest.fn(() => {
          atual = criada;
          return Promise.resolve(criada);
        }),
        update,
        updateMany,
      },
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ timezone: 'America/Sao_Paulo' }),
      },
    },
  };

  return { service: new AiUsageService(prisma as never), prisma };
}

describe('a virada do ciclo', () => {
  it('só zera quem ainda vê o ciclo velho (duas respostas juntas não zeram duas vezes)', async () => {
    const { service, prisma } = montar({
      aiRepliesUsed: 900,
      aiUsagePeriodStart: new Date('2026-01-01T12:00:00Z'),
    });

    await service.limite();

    const [[{ where }]] = prisma.db.billingAccount.updateMany.mock
      .calls as unknown as [[{ where: Record<string, unknown> }]];
    expect(where).toMatchObject({
      id: 'billing-1',
      OR: [
        { aiUsagePeriodStart: null },
        { aiUsagePeriodStart: { lt: expect.any(Date) as Date } },
      ],
    });
  });
});

describe('AiUsageService.limite', () => {
  it('deixa responder enquanto não bateu no teto', async () => {
    const { service } = montar({
      aiMonthlyMessageLimit: 10,
      aiRepliesUsed: 5,
      aiUsagePeriodStart: new Date(),
    });

    const limite = await service.limite();

    expect(limite).toMatchObject({
      podeResponder: true,
      usadas: 5,
      limite: 10,
      extras: 0,
    });
  });

  it('soma o pacote extra comprado ao limite e ainda deixa responder depois de bater no teto do plano', async () => {
    const { service } = montar({
      aiMonthlyMessageLimit: 10,
      aiRepliesUsed: 10,
      aiExtraMessagesThisPeriod: 5,
      aiUsagePeriodStart: new Date(),
    });

    const limite = await service.limite();

    expect(limite).toMatchObject({
      podeResponder: true,
      usadas: 10,
      limite: 15,
      extras: 5,
    });
  });

  it('para de deixar responder ao bater no teto', async () => {
    const { service } = montar({
      aiMonthlyMessageLimit: 10,
      aiRepliesUsed: 10,
      aiUsagePeriodStart: new Date(),
    });

    const limite = await service.limite();

    expect(limite.podeResponder).toBe(false);
  });

  it('zera sozinho quando o ciclo vira, sem rotina agendada', async () => {
    const mesPassado = new Date();
    mesPassado.setUTCMonth(mesPassado.getUTCMonth() - 1);
    mesPassado.setUTCDate(mesPassado.getUTCDate() - 1);

    const { service, prisma } = montar({
      aiMonthlyMessageLimit: 10,
      aiRepliesUsed: 10,
      aiUsagePeriodStart: mesPassado,
    });

    const limite = await service.limite();

    expect(limite).toMatchObject({
      podeResponder: true,
      usadas: 0,
      limite: 10,
      extras: 0,
    });
    expect(prisma.db.billingAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aiRepliesUsed: 0,
          aiExtraMessagesThisPeriod: 0,
        }),
      }),
    );
  });

  it('sem conta ainda criada, cria uma e usa o padrão do plano', async () => {
    const { service, prisma } = montar(null);

    const limite = await service.limite();

    expect(prisma.db.billingAccount.create).toHaveBeenCalled();
    expect(limite.limite).toBe(3000);
  });
});

/**
 * O ciclo é o da assinatura, não o do calendário.
 *
 * O relato: "ao invés de renovar todo dia primeiro deveria ser todo dia
 * do mês que ele assinou". Quem assina dia 15 paga dia 15 — e as
 * respostas renovam junto com a fatura.
 */
describe('as respostas renovam no dia da assinatura', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-09-30T15:00:00Z') });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('assinou dia 15: o que foi usado desde 15/09 continua contando no dia 30', async () => {
    const { service, prisma } = montar({
      aiCicloDia: 15,
      aiRepliesUsed: 40,
      aiUsagePeriodStart: new Date('2026-09-16T12:00:00Z'),
    });

    const limite = await service.limite();

    expect(limite.usadas).toBe(40);
    expect(prisma.db.billingAccount.update).not.toHaveBeenCalled();
  });

  it('e renova no dia 15 do mês seguinte, à meia-noite de São Paulo', async () => {
    const { service } = montar({
      aiCicloDia: 15,
      aiUsagePeriodStart: new Date('2026-09-16T12:00:00Z'),
    });

    const limite = await service.limite();

    expect(limite.renovaDia).toBe(15);
    expect(limite.renovaEm.toISOString()).toBe('2026-10-15T03:00:00.000Z');
  });

  it('o uso de antes do dia 15 é do ciclo passado: zera', async () => {
    const { service } = montar({
      aiCicloDia: 15,
      aiRepliesUsed: 900,
      aiUsagePeriodStart: new Date('2026-09-10T12:00:00Z'),
    });

    const limite = await service.limite();
    expect(limite.usadas).toBe(0);
  });

  it('sem o dia do Stripe, vale o dia em que a conta foi criada', async () => {
    const { service } = montar({
      createdAt: new Date('2026-08-20T15:00:00Z'),
      aiUsagePeriodStart: new Date('2026-09-21T12:00:00Z'),
    });

    const limite = await service.limite();
    expect(limite.renovaDia).toBe(20);
    expect(limite.renovaEm.toISOString()).toBe('2026-10-20T03:00:00.000Z');
  });
});

describe('AiUsageService.registrar', () => {
  it('soma uma resposta e os tokens dela à conta corrente', async () => {
    const { service, prisma } = montar({
      aiMonthlyMessageLimit: 3000,
      aiRepliesUsed: 4,
      aiUsagePeriodStart: new Date(),
    });

    await service.registrar({ inputTokens: 2000, outputTokens: 150 });

    expect(prisma.db.billingAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aiRepliesUsed: { increment: 1 },
          aiInputTokensUsed: { increment: 2000 },
          aiOutputTokensUsed: { increment: 150 },
        }),
      }),
    );
  });
});

describe('respostas compradas na virada do mês', () => {
  it('o plano é gasto primeiro; o que sobrou do pacote passa pro mês seguinte', () => {
    // Plano 5.000, pacote 3.000, usou 6.000: o pacote pagou 1.000.
    expect(
      extrasQueSobraram({
        aiMonthlyMessageLimit: 5000,
        aiExtraMessagesThisPeriod: 3000,
        aiRepliesUsed: 6000,
      }),
    ).toBe(2000);
    // Nem encostou no pacote: sobra inteiro.
    expect(
      extrasQueSobraram({
        aiMonthlyMessageLimit: 5000,
        aiExtraMessagesThisPeriod: 3000,
        aiRepliesUsed: 1200,
      }),
    ).toBe(3000);
    // Gastou tudo: nada sobra (e nunca negativo).
    expect(
      extrasQueSobraram({
        aiMonthlyMessageLimit: 5000,
        aiExtraMessagesThisPeriod: 3000,
        aiRepliesUsed: 9000,
      }),
    ).toBe(0);
  });
});
