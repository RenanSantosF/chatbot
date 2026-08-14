import { RoutingService } from './routing.service';

/**
 * "Urgente vai pro plantonista, cobrança vai pro financeiro."
 *
 * O que a empresa configura aqui é a decisão explícita do dono sobre quem
 * atende o quê — e ela precisa valer nos dois caminhos: quando a IA nomeia
 * a regra e quando o sistema escala sozinho, sem ninguém nomear nada. O
 * segundo caso é o que mais importa, porque é justamente quando a
 * conversa chegou num ponto que ninguém previu.
 */
function servicoCom(
  regras: Record<string, unknown>[],
  proximoDaFila: string | null = 'user-do-rodizio',
) {
  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      routingRule: {
        findMany: jest.fn().mockResolvedValue(regras),
        findFirst: jest
          .fn()
          .mockImplementation(
            (args: { where: { key: string } }) =>
              regras.find((r) => r.key === args.where.key) ?? null,
          ),
      },
    },
  };
  const queues = {
    pickNextMember: jest.fn().mockResolvedValue(proximoDaFila),
  };

  return {
    service: new RoutingService(prisma as never, queues as never),
    queues,
  };
}

const regra = (extra: Record<string, unknown> = {}) => ({
  key: 'plantao',
  name: 'Plantão',
  subject: 'urgências',
  active: true,
  minPriority: 'URGENT',
  targetUserId: 'user-plantonista',
  targetQueueId: null,
  ...extra,
});

describe('resolveByPriority — quando o sistema escala sozinho', () => {
  it('acha o destino sem a IA nomear regra nenhuma', async () => {
    // Antes as regras só eram consultadas se a IA nomeasse uma, então
    // "urgente vai pro fulano" não pegava nas travas automáticas.
    const { service } = servicoCom([regra()]);

    await expect(service.resolveByPriority('URGENT')).resolves.toEqual({
      ruleName: 'Plantão',
      queueId: null,
      assignedUserId: 'user-plantonista',
    });
  });

  it('ignora a regra que exige mais prioridade do que a conversa tem', async () => {
    // É o que faz "só urgente vai pro plantonista" não mandar o dia inteiro
    // pra ele.
    const { service } = servicoCom([regra()]);

    await expect(service.resolveByPriority('NORMAL')).resolves.toBeNull();
  });

  it('entre várias que servem, ganha a mais exigente', async () => {
    // Uma regra escrita pra URGENTE é mais intencional que uma que aceita
    // qualquer coisa.
    const { service } = servicoCom([
      regra({
        key: 'geral',
        name: 'Geral',
        minPriority: 'LOW',
        targetUserId: 'user-geral',
      }),
      regra({ key: 'plantao', name: 'Plantão', minPriority: 'URGENT' }),
    ]);

    const destino = await service.resolveByPriority('URGENT');

    expect(destino?.ruleName).toBe('Plantão');
  });

  it('regra que aponta pra setor usa o rodízio pra escolher a pessoa', async () => {
    const { service, queues } = servicoCom([
      regra({ targetUserId: null, targetQueueId: 'fila-financeiro' }),
    ]);

    const destino = await service.resolveByPriority('URGENT');

    expect(queues.pickNextMember).toHaveBeenCalledWith('fila-financeiro');
    expect(destino).toEqual({
      ruleName: 'Plantão',
      queueId: 'fila-financeiro',
      assignedUserId: 'user-do-rodizio',
    });
  });

  it('setor vazio manda a conversa pro setor mesmo sem dono', async () => {
    // Melhor a conversa ficar visível pro setor do que parar de escalar
    // porque ninguém foi cadastrado na fila ainda.
    const { service } = servicoCom(
      [regra({ targetUserId: null, targetQueueId: 'fila-vazia' })],
      null,
    );

    await expect(service.resolveByPriority('URGENT')).resolves.toEqual({
      ruleName: 'Plantão',
      queueId: 'fila-vazia',
      assignedUserId: null,
    });
  });

  it('sem regra configurada, não inventa destino', async () => {
    const { service } = servicoCom([]);
    await expect(service.resolveByPriority('URGENT')).resolves.toBeNull();
  });
});

describe('resolveTarget — quando a IA nomeia a regra', () => {
  it('respeita a regra escolhida', async () => {
    const { service } = servicoCom([regra({ minPriority: 'NORMAL' })]);

    await expect(
      service.resolveTarget('plantao', 'NORMAL'),
    ).resolves.toMatchObject({
      ruleName: 'Plantão',
      assignedUserId: 'user-plantonista',
    });
  });

  it('recusa a regra quando a conversa não alcança a prioridade dela', async () => {
    const { service } = servicoCom([regra()]);
    await expect(service.resolveTarget('plantao', 'LOW')).resolves.toBeNull();
  });

  it('regra inventada pela IA não vira destino', async () => {
    const { service } = servicoCom([regra()]);
    await expect(
      service.resolveTarget('regra-que-nao-existe', 'URGENT'),
    ).resolves.toBeNull();
  });

  it('sem regra nomeada, devolve nulo sem consultar o banco', async () => {
    const { service } = servicoCom([regra()]);
    await expect(service.resolveTarget(null, 'URGENT')).resolves.toBeNull();
  });
});
