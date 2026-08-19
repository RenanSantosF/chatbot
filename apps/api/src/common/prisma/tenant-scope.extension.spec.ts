import { applyTenantScope } from './tenant-scope.extension';
import type { PrismaClient } from '../../../generated/prisma/client';

/**
 * A camada que impede uma empresa de ver a conversa de outra.
 *
 * É o único ponto do sistema em que um esquecimento não dá erro nenhum:
 * uma query sem `tenantId` funciona perfeitamente e devolve dado alheio.
 * Por isso a extensão existe — e por isso ela precisa de teste próprio, e
 * não só da confiança de que cada serviço lembrou de filtrar.
 *
 * O client é falso de propósito: o que está sendo testado é o argumento que
 * CHEGA no Prisma, não o Prisma.
 */
function clientFalso() {
  const chamadas: { model: string; operation: string; args: unknown }[] = [];

  const client = {
    $extends: ({
      query,
    }: {
      query: {
        $allModels: {
          $allOperations: (ctx: {
            model: string;
            operation: string;
            args: unknown;
            query: (a: unknown) => Promise<unknown>;
          }) => Promise<unknown>;
        };
      };
    }) => ({
      executar: (model: string, operation: string, args: unknown) =>
        query.$allModels.$allOperations({
          model,
          operation,
          args,
          query: (finais) => {
            chamadas.push({ model, operation, args: finais });
            return Promise.resolve(finais);
          },
        }),
    }),
  } as unknown as PrismaClient;

  const escopado = applyTenantScope(client, 'tenant-a') as unknown as {
    executar: (m: string, o: string, a: unknown) => Promise<unknown>;
  };

  return { escopado, chamadas };
}

/** O que a extensão entregou ao Prisma depois de mexer nos argumentos. */
interface ArgumentosFinais {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
  create?: Record<string, unknown>;
}

async function argumentoFinal(
  model: string,
  operation: string,
  args: unknown,
): Promise<ArgumentosFinais> {
  const { escopado, chamadas } = clientFalso();
  await escopado.executar(model, operation, args);
  return chamadas[0].args as ArgumentosFinais;
}

describe('leitura', () => {
  it.each([
    'findMany',
    'findFirst',
    'findUnique',
    'count',
    'aggregate',
    'groupBy',
  ])('%s ganha o filtro de tenant', async (operacao) => {
    const args = await argumentoFinal('Conversation', operacao, {});
    expect(args.where).toEqual({ tenantId: 'tenant-a' });
  });

  it('preserva o filtro que o serviço já tinha escrito', async () => {
    const args = await argumentoFinal('Conversation', 'findMany', {
      where: { status: 'OPEN' },
    });
    expect(args.where).toEqual({ status: 'OPEN', tenantId: 'tenant-a' });
  });

  it('o tenant vence um tenantId forjado pelo chamador', async () => {
    // Se este teste cair, um parâmetro vindo do corpo da requisição passa a
    // conseguir ler dado de outra empresa.
    const args = await argumentoFinal('Message', 'findMany', {
      where: { tenantId: 'tenant-b' },
    });
    expect(args.where?.tenantId).toBe('tenant-a');
  });
});

describe('escrita', () => {
  it('create carimba o tenant', async () => {
    const args = await argumentoFinal('Customer', 'create', {
      data: { phone: '5527999998888' },
    });
    expect(args.data).toEqual({ phone: '5527999998888', tenantId: 'tenant-a' });
  });

  it('createMany carimba cada linha da lista', async () => {
    const args = await argumentoFinal('Message', 'createMany', {
      data: [{ content: 'a' }, { content: 'b' }],
    });
    expect(args.data).toEqual([
      { content: 'a', tenantId: 'tenant-a' },
      { content: 'b', tenantId: 'tenant-a' },
    ]);
  });

  it('createMany com um registro só também é carimbado', async () => {
    // `data` aceita lista OU objeto; sem tratar o segundo caso a escrita ia
    // pro banco sem tenant.
    const args = await argumentoFinal('Message', 'createMany', {
      data: { content: 'a' },
    });
    expect(args.data).toEqual({ content: 'a', tenantId: 'tenant-a' });
  });

  it.each(['update', 'updateMany', 'delete', 'deleteMany'])(
    '%s só alcança linha do próprio tenant',
    async (operacao) => {
      const args = await argumentoFinal('Conversation', operacao, {
        where: { id: 'conversa-de-outra-empresa' },
      });
      expect(args.where).toEqual({
        id: 'conversa-de-outra-empresa',
        tenantId: 'tenant-a',
      });
    },
  );

  it('upsert filtra na busca e carimba na criação', async () => {
    const args = await argumentoFinal('AiTool', 'upsert', {
      where: { key: 'transferToQueue' },
      create: { key: 'transferToQueue', enabled: true },
      update: { enabled: true },
    });
    expect(args.where?.tenantId).toBe('tenant-a');
    expect(args.create?.tenantId).toBe('tenant-a');
  });
});

describe('os modelos que faltavam', () => {
  /*
   * Um por defeito relatado, e não por completude.
   *
   * `EvolutionSettings` é o caro: todo acesso a ela é `findFirst()` sem
   * `where`, confiando nesta lista pra achar "a sessão desta empresa".
   * Fora dela, a segunda empresa a conectar reescrevia a sessão da
   * primeira — o painel de uma mostrando o estado da outra, e a mensagem
   * de saída indo pelo WhatsApp de quem não era.
   */
  it('a conexão por QR code é de uma empresa só', async () => {
    const args = await argumentoFinal('EvolutionSettings', 'findFirst', {});
    expect(args.where).toEqual({ tenantId: 'tenant-a' });
  });

  it.each(['Tag', 'ConversationTag', 'QuickReply'])(
    '%s não vaza pra lista da empresa vizinha',
    async (model) => {
      const args = await argumentoFinal(model, 'findMany', {});
      expect(args.where).toEqual({ tenantId: 'tenant-a' });
    },
  );
});

describe('modelos fora do isolamento', () => {
  it('Tenant não é filtrado por tenantId — ele é o tenant', async () => {
    const args = await argumentoFinal('Tenant', 'findMany', {});
    expect(args).toEqual({});
  });

  it('KnowledgeChunk fica de fora de propósito (é SQL cru)', async () => {
    // O campo de embedding é Unsupported, então leitura e escrita dele não
    // passam pela extensão. O isolamento dele é manual, no próprio SQL —
    // ver KnowledgeService. Este teste existe pra registrar a exceção: se
    // alguém adicionar o model à lista achando que resolve, ele quebra e
    // aponta pro lugar certo.
    const args = await argumentoFinal('KnowledgeChunk', 'findMany', {});
    expect(args).toEqual({});
  });
});
