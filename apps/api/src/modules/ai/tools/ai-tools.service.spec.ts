import { AiToolsService } from './ai-tools.service';

/**
 * `setConfig` — a escrita por trás do clique em Configurações > IA > Ferramentas.
 *
 * A coluna do banco nasce travada (`enabled: false`, `REQUIRES_APPROVAL`)
 * de propósito — é a régua de segurança pra ferramenta nova e perigosa que
 * ainda vier a existir. Mas a TELA promete o oposto pra quem nunca tocou
 * numa ferramenta (`listConfigured`: sem linha = ligada e em "Permitir";
 * ver permissoes.spec.ts). O bug estava na emenda dos dois: `PATCH` só a
 * permissão de uma ferramenta sem linha ainda criava essa linha SEM o
 * campo `enabled` — e o banco preenchia sozinho com `false`, desligando a
 * ferramenta de verdade como efeito colateral de mudar só a permissão (e
 * o mesmo ao contrário, para permissão).
 */
function servicoCom(configuracoes: Record<string, unknown>[] = []) {
  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      aiTool: {
        findMany: jest.fn().mockResolvedValue(configuracoes),
        upsert: jest
          .fn()
          .mockImplementation(
            (args: {
              where: { tenantId_key: { key: string } };
              create: Record<string, unknown>;
              update: Record<string, unknown>;
            }) => {
              const key = args.where.tenantId_key.key;
              const existente = configuracoes.find((item) => item.key === key);
              if (existente) {
                Object.assign(existente, args.update);
                return existente;
              }
              // Mesma semântica do Prisma real: só grava o que veio em
              // `create` — nenhum preenchimento escondido aqui que
              // disfarçasse o bug num teste que rodasse contra o código
              // antigo.
              const criado = { key, ...args.create };
              configuracoes.push(criado);
              return criado;
            },
          ),
      },
      aiSettings: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ memoryMode: 'IMPORTANT_ONLY' }),
      },
      queue: { findMany: jest.fn().mockResolvedValue([]) },
    },
  };

  const service = new AiToolsService(
    prisma as never,
    { emitToUsers: jest.fn() } as never,
    {
      findByKey: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
    } as never,
    {
      resolveTarget: jest.fn().mockResolvedValue(null),
      listForAi: jest.fn().mockResolvedValue([]),
    } as never,
    {
      missingRequired: jest.fn().mockResolvedValue([]),
      describeForAi: jest.fn().mockResolvedValue([]),
    } as never,
    { get: jest.fn().mockResolvedValue({ queueVisibility: 'ALL' }) } as never,
  );

  return { service, prisma };
}

describe('AiToolsService.setConfig', () => {
  it('mudar só a permissão de uma ferramenta nunca tocada não desliga ela', async () => {
    const { service } = servicoCom([]);

    const resultado = await service.setConfig('transferToQueue', {
      permission: 'REQUIRES_APPROVAL',
    });

    expect(resultado.enabled).toBe(true);
    expect(resultado.permission).toBe('REQUIRES_APPROVAL');
  });

  it('mudar só o liga/desliga de uma ferramenta nunca tocada não muda a permissão pro padrão travado da coluna', async () => {
    const { service } = servicoCom([]);

    const resultado = await service.setConfig('rememberCustomerInfo', {
      enabled: false,
    });

    expect(resultado.enabled).toBe(false);
    expect(resultado.permission).toBe('ALLOW');
  });

  it('em uma ferramenta já configurada, só o campo enviado muda — o resto fica como estava', async () => {
    const { service } = servicoCom([
      { key: 'collectCustomerData', enabled: true, permission: 'DENY' },
    ]);

    const resultado = await service.setConfig('collectCustomerData', {
      permission: 'REQUIRES_APPROVAL',
    });

    expect(resultado.enabled).toBe(true);
    expect(resultado.permission).toBe('REQUIRES_APPROVAL');
  });
});
