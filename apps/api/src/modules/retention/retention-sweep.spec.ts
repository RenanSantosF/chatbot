import { RetentionSweepService } from './retention-sweep.service';

/**
 * A varredura que faz o prazo de guarda valer.
 *
 * O defeito que estes testes travam não era de lógica: o apagamento estava
 * escrito e correto, e ninguém o chamava. A tela prometia "passado o
 * prazo, as mensagens são apagadas", o prazo passava, e nada acontecia.
 * Por isso o primeiro caso aqui é o mais bobo de todos — que a varredura
 * de fato passe por cada empresa configurada.
 */
function montar(
  configs: { tenantId: string; keepMessagesDays: number | null; id?: string }[],
  apagadas = 0,
) {
  const deleteMany = jest.fn().mockResolvedValue({ count: apagadas });
  const update = jest.fn().mockResolvedValue({});

  const prisma = {
    client: {
      retentionSettings: {
        findMany: jest.fn().mockResolvedValue(configs),
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: { where: { tenantId: string } }) =>
            Promise.resolve(
              configs.find((c) => c.tenantId === where.tenantId) ?? null,
            ),
          ),
        update,
      },
      message: { deleteMany },
    },
  };

  return {
    service: new RetentionSweepService(prisma as never),
    deleteMany,
    update,
  };
}

const config = (tenantId: string, dias: number | null) => ({
  id: `cfg-${tenantId}`,
  tenantId,
  keepMessagesDays: dias,
});

describe('varredura de retenção', () => {
  it('passa por todas as empresas que configuraram prazo', async () => {
    const { service, deleteMany } = montar(
      [config('a', 30), config('b', 90)],
      5,
    );

    const resultado = await service.varrer();

    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(resultado).toEqual({ tenants: 2, deleted: 10 });
  });

  it('sem prazo configurado, não apaga nada', async () => {
    // Nulo quer dizer "guarda pra sempre", e é o padrão. Apagar aqui seria
    // destruir histórico de quem nunca pediu.
    const { service, deleteMany } = montar([config('a', null)]);

    await service.purgarTenant('a');

    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('o corte é o prazo contado pra trás a partir de hoje', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-17T12:00:00Z'));
    const { service, deleteMany } = montar([config('a', 30)]);

    await service.purgarTenant('a');

    const { where } = deleteMany.mock.calls[0][0] as {
      where: { tenantId: string; createdAt: { lt: Date } };
    };
    expect(where.tenantId).toBe('a');
    expect(where.createdAt.lt.toISOString()).toBe('2026-07-18T12:00:00.000Z');
    jest.useRealTimers();
  });

  it('uma empresa com problema não para a varredura das outras', async () => {
    const { service } = montar([config('a', 30), config('b', 30)], 3);
    const serviceComFalha = service as unknown as {
      purgarTenant: (id: string) => Promise<number>;
    };
    const original = serviceComFalha.purgarTenant.bind(service);
    serviceComFalha.purgarTenant = (id: string) =>
      id === 'a' ? Promise.reject(new Error('banco fora')) : original(id);

    const resultado = await service.varrer();

    // A que falhou não conta, a outra apagou normalmente.
    expect(resultado).toEqual({ tenants: 2, deleted: 3 });
  });

  it('registra quando apagou, pra a tela poder mostrar a última limpeza', async () => {
    const { service, update } = montar([config('a', 30)], 7);

    await service.purgarTenant('a');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cfg-a' },
        data: expect.objectContaining({ lastPurgeDeleted: 7 }),
      }),
    );
  });
});
