import { RetentionSweepService } from './retention-sweep.service';

/**
 * A varredura que faz o prazo de guarda e a cota valerem.
 *
 * Três promessas travadas aqui:
 *   1. ela passa por cada empresa (o apagamento já existiu escrito e
 *      correto sem que ninguém o chamasse);
 *   2. apagar mensagem apaga também o arquivo dela no bucket (antes o
 *      arquivo ficava órfão pra sempre);
 *   3. cota cheia com a limpeza ligada apaga das mais antigas pras mais
 *      novas, só até sobrar 90% — nem uma a mais.
 */

type Linha = { id: string; chave: string | null; bytes: bigint };

interface Cenario {
  empresas?: string[];
  configs?: Record<
    string,
    { keepMessagesDays: number | null; autoPurgeOnFull?: boolean }
  >;
  lotes?: Linha[][];
  medicoes?: { texto: number; arquivos: number }[];
  cota?: number;
  falharEm?: string | null;
}

function montar({
  empresas = ['a'],
  configs = {},
  lotes = [],
  medicoes = [],
  cota = 1000,
  falharEm = null,
}: Cenario = {}) {
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const updateSettings = jest.fn().mockResolvedValue({});
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const apagarChaves = jest.fn().mockResolvedValue(0);
  const filaDeLotes = [...lotes];
  const filaDeMedicoes = [...medicoes];
  const selecoes: unknown[][] = [];

  const queryRaw = jest.fn(
    (partes: TemplateStringsArray, ...valores: unknown[]) => {
      const sql = partes.join('?');
      if (falharEm && valores.includes(falharEm))
        return Promise.reject(new Error('banco caiu'));
      if (sql.includes('AS texto')) {
        const m = filaDeMedicoes.shift() ?? { texto: 0, arquivos: 0 };
        return Promise.resolve([
          { texto: BigInt(m.texto), arquivos: BigInt(m.arquivos), total: 10n },
        ]);
      }
      if (sql.includes('ORDER BY')) {
        selecoes.push(valores);
        return Promise.resolve(filaDeLotes.shift() ?? []);
      }
      return Promise.resolve([]); // tamanhos pendentes: nenhum
    },
  );

  const prisma = {
    client: {
      $queryRaw: queryRaw,
      $executeRaw: jest.fn().mockResolvedValue(1),
      tenant: {
        findMany: jest.fn().mockResolvedValue(empresas.map((id) => ({ id }))),
      },
      retentionSettings: {
        findFirst: jest.fn(({ where }: { where: { tenantId: string } }) => {
          const c = configs[where.tenantId];
          return Promise.resolve(
            c
              ? { id: `cfg-${where.tenantId}`, autoPurgeOnFull: false, ...c }
              : null,
          );
        }),
        update: updateSettings,
      },
      billingAccount: {
        findFirst: jest.fn().mockResolvedValue({ quotaBytes: BigInt(cota) }),
        updateMany,
      },
      historicoGuardado: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      message: { deleteMany },
    },
  };
  const storage = { ligado: true, apagarChaves, tamanho: jest.fn() };

  return {
    service: new RetentionSweepService(prisma as never, storage as never),
    deleteMany,
    updateSettings,
    updateMany,
    apagarChaves,
    selecoes,
  };
}

const linha = (
  id: string,
  bytes: number,
  chave: string | null = null,
): Linha => ({
  id,
  chave,
  bytes: BigInt(bytes),
});

const idsApagados = (deleteMany: jest.Mock) =>
  deleteMany.mock.calls.flatMap(
    ([args]: [{ where: { id: { in: string[] } } }]) => args.where.id.in,
  );

describe('varredura de armazenamento', () => {
  it('passa por todas as empresas e aplica o prazo de quem tem', async () => {
    const { service, deleteMany } = montar({
      empresas: ['a', 'b', 'c'],
      configs: { a: { keepMessagesDays: 30 }, b: { keepMessagesDays: 90 } },
      lotes: [[linha('a1', 10)], [linha('b1', 10)]],
    });

    const resultado = await service.varrer();

    expect(resultado.tenants).toBe(3);
    expect(idsApagados(deleteMany)).toEqual(['a1', 'b1']);
  });

  it('sem prazo e sem limpeza automática, não apaga nada', async () => {
    const { service, deleteMany } = montar({
      configs: { a: { keepMessagesDays: null } },
      medicoes: [{ texto: 5000, arquivos: 0 }],
    });

    await service.varrer();

    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('o corte é o prazo contado pra trás a partir de hoje', async () => {
    const { service, selecoes } = montar({
      configs: { a: { keepMessagesDays: 30 } },
    });

    await service.purgarTenant('a');

    const fragmento = selecoes[0][1] as { values: unknown[] };
    const corte = fragmento.values[0] as Date;
    const dias = (Date.now() - corte.getTime()) / 86_400_000;
    expect(Math.round(dias)).toBe(30);
  });

  it('apagar a mensagem apaga o arquivo dela no bucket', async () => {
    const { service, apagarChaves } = montar({
      configs: { a: { keepMessagesDays: 30 } },
      lotes: [[linha('m1', 10, 'a/2026/09/foto.jpg'), linha('m2', 10)]],
    });

    await service.purgarTenant('a');

    expect(apagarChaves).toHaveBeenCalledWith(['a/2026/09/foto.jpg']);
  });

  it('mede texto e arquivos juntos e grava na conta', async () => {
    const { service, updateMany } = montar({
      medicoes: [{ texto: 300, arquivos: 700 }],
    });

    const medicao = await service.medir('a');

    expect(medicao).toMatchObject({
      usedBytes: 1000,
      textBytes: 300,
      fileBytes: 700,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'a' },
      data: { usedBytes: 1000n, measuredAt: expect.any(Date) as Date },
    });
  });

  it('cota cheia com limpeza ligada: apaga das mais antigas até sobrar 90%', async () => {
    // 1100 de 1000: precisa liberar 200. Cada mensagem vale 80 → saem 3.
    const { service, deleteMany, apagarChaves } = montar({
      configs: { a: { keepMessagesDays: null, autoPurgeOnFull: true } },
      medicoes: [{ texto: 600, arquivos: 500 }],
      lotes: [
        [
          linha('velha1', 80, 'k1'),
          linha('velha2', 80),
          linha('velha3', 80),
          linha('nova', 80, 'k4'),
        ],
      ],
    });

    await service.liberarEspaco('a');

    expect(idsApagados(deleteMany)).toEqual(['velha1', 'velha2', 'velha3']);
    expect(apagarChaves).toHaveBeenCalledWith(['k1']);
  });

  it('cota cheia com limpeza desligada: não apaga (o painel só avisa)', async () => {
    const { service, deleteMany } = montar({
      configs: { a: { keepMessagesDays: null, autoPurgeOnFull: false } },
      medicoes: [{ texto: 5000, arquivos: 0 }],
    });

    await service.liberarEspaco('a');

    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('abaixo da cota, a limpeza automática não mexe em nada', async () => {
    const { service, deleteMany } = montar({
      configs: { a: { keepMessagesDays: null, autoPurgeOnFull: true } },
      medicoes: [{ texto: 400, arquivos: 400 }],
    });

    await service.liberarEspaco('a');

    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('uma empresa com problema não para a varredura das outras', async () => {
    const { service, deleteMany } = montar({
      empresas: ['quebrada', 'boa'],
      configs: {
        quebrada: { keepMessagesDays: 30 },
        boa: { keepMessagesDays: 30 },
      },
      lotes: [[linha('b1', 10)]],
      falharEm: 'quebrada',
    });

    await service.varrer();

    expect(idsApagados(deleteMany)).toEqual(['b1']);
  });

  it('registra quando apagou, pra a tela poder mostrar a última limpeza', async () => {
    const { service, updateSettings } = montar({
      configs: { a: { keepMessagesDays: 30 } },
      lotes: [[linha('m1', 10), linha('m2', 10)]],
    });

    await service.purgarTenant('a');

    expect(updateSettings).toHaveBeenCalledWith({
      where: { id: 'cfg-a' },
      data: { lastPurgeAt: expect.any(Date) as Date, lastPurgeDeleted: 2 },
    });
  });
});
