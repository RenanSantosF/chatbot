import { QueuesService } from './queues.service';

/**
 * O rodízio da fila.
 *
 * É o que distribui trabalho de forma justa: sem ele, a lógica de
 * "quem recebe a próxima" cai sempre na mesma pessoa — normalmente a
 * primeira da lista, que vira o gargalo do setor inteiro.
 *
 * O ponteiro fica salvo na fila (e não é uma aproximação por "quem está há
 * mais tempo sem receber") justamente pra o rodízio sobreviver a
 * reinicialização do servidor.
 */
function servicoCom(fila: Record<string, unknown> | null) {
  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      queue: {
        findFirst: jest.fn().mockResolvedValue(fila),
        update: jest.fn().mockResolvedValue({}),
      },
    },
  };

  return { service: new QueuesService(prisma as never), prisma };
}

const comMembros = (
  userIds: string[],
  lastAssignedMemberId: string | null = null,
) => ({
  id: 'fila-1',
  lastAssignedMemberId,
  members: userIds.map((userId) => ({ userId })),
});

describe('pickNextMember', () => {
  it('começa pelo primeiro quando ninguém recebeu ainda', async () => {
    const { service } = servicoCom(comMembros(['ana', 'bruno', 'carla']));
    await expect(service.pickNextMember('fila-1')).resolves.toBe('ana');
  });

  it('anda um por vez', async () => {
    const { service } = servicoCom(
      comMembros(['ana', 'bruno', 'carla'], 'ana'),
    );
    await expect(service.pickNextMember('fila-1')).resolves.toBe('bruno');
  });

  it('dá a volta ao chegar no fim', async () => {
    const { service } = servicoCom(
      comMembros(['ana', 'bruno', 'carla'], 'carla'),
    );
    await expect(service.pickNextMember('fila-1')).resolves.toBe('ana');
  });

  it('recomeça do início quando quem estava no ponteiro saiu da fila', async () => {
    // Um membro removido não pode travar o rodízio da equipe inteira.
    const { service } = servicoCom(
      comMembros(['ana', 'bruno'], 'quem-saiu-da-empresa'),
    );
    await expect(service.pickNextMember('fila-1')).resolves.toBe('ana');
  });

  it('salva o ponteiro, senão o rodízio não sobrevive ao próximo pedido', async () => {
    const { service, prisma } = servicoCom(comMembros(['ana', 'bruno'], 'ana'));

    await service.pickNextMember('fila-1');

    expect(prisma.db.queue.update).toHaveBeenCalledWith({
      where: { id: 'fila-1' },
      data: { lastAssignedMemberId: 'bruno' },
    });
  });

  it('fila de uma pessoa só devolve sempre ela', async () => {
    const { service } = servicoCom(comMembros(['ana'], 'ana'));
    await expect(service.pickNextMember('fila-1')).resolves.toBe('ana');
  });

  it('fila sem ninguém não escolhe nem grava ponteiro', async () => {
    const { service, prisma } = servicoCom(comMembros([]));

    await expect(service.pickNextMember('fila-1')).resolves.toBeNull();
    expect(prisma.db.queue.update).not.toHaveBeenCalled();
  });

  it('fila que não existe devolve nulo em vez de estourar', async () => {
    // Chamado no meio de um escalonamento: quebrar aqui deixaria a conversa
    // sem destino nenhum.
    const { service } = servicoCom(null);
    await expect(service.pickNextMember('fila-sumida')).resolves.toBeNull();
  });

  it('dá a volta completa e recomeça, sem pular ninguém', async () => {
    const membros = ['ana', 'bruno', 'carla'];
    let ponteiro: string | null = null;
    const sorteados: (string | null)[] = [];

    for (let i = 0; i < 6; i++) {
      const { service, prisma } = servicoCom(comMembros(membros, ponteiro));
      const escolhido = await service.pickNextMember('fila-1');
      sorteados.push(escolhido);
      const gravado = prisma.db.queue.update.mock.calls[0] as [
        { data: { lastAssignedMemberId: string } },
      ];
      ponteiro = gravado[0].data.lastAssignedMemberId;
    }

    expect(sorteados).toEqual([
      'ana',
      'bruno',
      'carla',
      'ana',
      'bruno',
      'carla',
    ]);
  });
});
