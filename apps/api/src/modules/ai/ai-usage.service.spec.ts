import { AiUsageService } from './ai-usage.service';

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

  const prisma = {
    tenantId: 'tenant-1',
    db: {
      billingAccount: {
        // `criada` (com os padrões) e não o `conta` cru: um teste que só
        // define os dois ou três campos que importa pra ele não deveria
        // precisar listar todos os outros só pra não virar `undefined`.
        findFirst: jest.fn().mockResolvedValue(conta ? criada : null),
        create: jest.fn().mockResolvedValue(criada),
        update,
      },
    },
  };

  return { service: new AiUsageService(prisma as never), prisma };
}

describe('AiUsageService.limite', () => {
  it('deixa responder enquanto não bateu no teto', async () => {
    const { service } = montar({
      aiMonthlyMessageLimit: 10,
      aiRepliesUsed: 5,
      aiUsagePeriodStart: new Date(),
    });

    const limite = await service.limite();

    expect(limite).toEqual({
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

    expect(limite).toEqual({
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

  it('zera sozinho quando o mês vira, sem rotina agendada', async () => {
    const mesPassado = new Date();
    mesPassado.setUTCMonth(mesPassado.getUTCMonth() - 1);

    const { service, prisma } = montar({
      aiMonthlyMessageLimit: 10,
      aiRepliesUsed: 10,
      aiUsagePeriodStart: mesPassado,
    });

    const limite = await service.limite();

    expect(limite).toEqual({
      podeResponder: true,
      usadas: 0,
      limite: 10,
      extras: 0,
    });
    expect(prisma.db.billingAccount.update).toHaveBeenCalledWith(
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
