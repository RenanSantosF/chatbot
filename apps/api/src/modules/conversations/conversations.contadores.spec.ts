import { ConversationsService } from './conversations.service';

/**
 * Os números da barra de filtros contra a lista que eles descrevem.
 *
 * O defeito relatado: filtrar por "Pendentes", ver uma conversa na lista, e
 * o botão "Minhas" logo abaixo dizendo 5. Os dois números estavam certos
 * cada um por si — o contador falava da empresa inteira, a lista falava do
 * recorte — e juntos na mesma tela viravam uma contradição. Quem trabalha
 * ali não tem como saber se as outras quatro são de outro setor, se a
 * página parou de carregar, ou se o sistema está errado.
 *
 * A regra que estes testes guardam: cada contador responde "se eu ligar
 * ISTO, mantendo o resto como está, quantas vou ver?".
 */
function montar() {
  const consultas: { where: Record<string, unknown> }[] = [];

  const registrar = (args?: { where?: unknown }) => {
    consultas.push({ where: (args?.where ?? {}) as Record<string, unknown> });
    return 0;
  };

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        count: jest.fn().mockImplementation(registrar),
        groupBy: jest.fn().mockImplementation((args?: { where?: unknown }) => {
          registrar(args);
          return [];
        }),
        findMany: jest.fn().mockImplementation((args?: { where?: unknown }) => {
          registrar(args);
          return [];
        }),
      },
      queueMember: { findMany: jest.fn().mockResolvedValue([]) },
    },
  };

  const service = new ConversationsService(
    prisma as never,
    {} as never,
    { emitToTenant: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    { get: jest.fn().mockResolvedValue({ queueVisibility: 'ALL' }) } as never,
    {} as never,
    {} as never,
  );

  return { service, consultas };
}

const atendente = { userId: 'user-ana', role: 'AGENT' as const };

/** Índices na ordem em que `counts` dispara as consultas. */
const TOTAL = 0;
const NAO_LIDAS = 1;
const MINHAS = 2;
const SEM_DONO = 3;
const ESPERANDO = 4;
const PENDENTES = 5;

describe('cada contador considera os outros filtros ligados', () => {
  it('"Minhas" conta dentro do grupo escolhido, não na empresa inteira', async () => {
    // Este é o defeito exato do relato.
    const { service, consultas } = montar();

    await service.counts({ statusGroup: 'PENDING', viewer: atendente });

    expect(consultas[MINHAS].where).toMatchObject({
      assignedUserId: 'user-ana',
      status: { in: ['OPEN', 'WAITING_AGENT', 'WAITING_CUSTOMER'] },
    });
  });

  it('"Não lidas" também respeita o grupo', async () => {
    const { service, consultas } = montar();

    await service.counts({ statusGroup: 'DONE', viewer: atendente });

    expect(consultas[NAO_LIDAS].where).toMatchObject({
      unreadCount: { gt: 0 },
      status: { in: ['RESOLVED', 'CLOSED'] },
    });
  });

  it('"Sem dono" respeita a prioridade escolhida', async () => {
    const { service, consultas } = montar();

    await service.counts({ priority: 'URGENT', viewer: atendente });

    expect(consultas[SEM_DONO].where).toMatchObject({
      assignedUserId: null,
      priority: 'URGENT',
    });
  });

  it('a busca por nome alcança todos os contadores', async () => {
    const { service, consultas } = montar();

    await service.counts({ search: 'Ana', viewer: atendente });

    for (const consulta of consultas) {
      expect(consulta.where).toHaveProperty('customer');
    }
  });
});

describe('cada contador sai do próprio filtro antes de contar', () => {
  it('"Minhas" ligado não faz "Minhas" contar só o que já está filtrado', async () => {
    // Sem tirar a própria faceta, o número viraria o tamanho da lista —
    // deixaria de ser informação e passaria a ser eco.
    const { service, consultas } = montar();

    await service.counts({
      assignedUserId: 'user-ana',
      unreadOnly: true,
      viewer: atendente,
    });

    // O de "Não lidas" mantém "Minhas" (é outro filtro ligado)...
    expect(consultas[NAO_LIDAS].where).toMatchObject({
      assignedUserId: 'user-ana',
      unreadCount: { gt: 0 },
    });
    // ...e o de "Minhas" mantém "Não lidas", que é o mesmo raciocínio.
    expect(consultas[MINHAS].where).toMatchObject({
      assignedUserId: 'user-ana',
      unreadCount: { gt: 0 },
    });
  });

  it('os botões de situação ignoram a situação atual', async () => {
    // Senão "Resolvidas" contaria dentro de "Pendentes" e daria zero
    // sempre — o botão nunca mais seria clicável com um número útil.
    const { service, consultas } = montar();

    await service.counts({ statusGroup: 'PENDING', viewer: atendente });

    expect(consultas[PENDENTES].where).toMatchObject({
      status: { in: ['OPEN', 'WAITING_AGENT', 'WAITING_CUSTOMER'] },
    });
    // "Tudo" não carrega situação nenhuma.
    expect(consultas[TOTAL].where).not.toHaveProperty('status');
  });

  it('mas os botões de situação respeitam os interruptores', async () => {
    const { service, consultas } = montar();

    await service.counts({
      statusGroup: 'PENDING',
      assignedUserId: 'user-ana',
      viewer: atendente,
    });

    expect(consultas[TOTAL].where).toMatchObject({
      assignedUserId: 'user-ana',
    });
    expect(consultas[PENDENTES].where).toMatchObject({
      assignedUserId: 'user-ana',
    });
  });
});

describe('a lista e os contadores usam o mesmo filtro', () => {
  it('o mesmo recorte produz o mesmo where nos dois caminhos', async () => {
    // É o que impede os dois de divergirem de novo: um filtro escrito duas
    // vezes vira dois filtros diferentes na primeira alteração.
    const { service, consultas } = montar();
    const recorte = {
      statusGroup: 'PENDING' as const,
      priority: 'HIGH' as const,
      unreadOnly: true,
      search: 'Ana',
      viewer: atendente,
    };

    await service.list(recorte);
    const daLista = consultas[0].where;

    consultas.length = 0;
    await service.counts(recorte);
    // O contador de "Não lidas" é o que reconstrói o filtro inteiro (ele
    // só tira e devolve a própria faceta).
    expect(consultas[NAO_LIDAS].where).toEqual(daLista);
  });
});

describe('o recorte por setor continua valendo', () => {
  it('o modo restrito alcança todos os contadores', async () => {
    const { service, consultas } = montar();
    const restrito = new ConversationsService(
      {
        tenantId: 'tenant-teste',
        db: {
          conversation: {
            count: jest
              .fn()
              .mockImplementation((args?: { where?: unknown }) => {
                consultas.push({
                  where: (args?.where ?? {}) as Record<string, unknown>,
                });
                return 0;
              }),
            groupBy: jest.fn().mockResolvedValue([]),
          },
          queueMember: {
            findMany: jest.fn().mockResolvedValue([{ queueId: 'fila-1' }]),
          },
        },
      } as never,
      {} as never,
      { emitToTenant: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        get: jest.fn().mockResolvedValue({ queueVisibility: 'OWN_QUEUES' }),
      } as never,
      {} as never,
      {} as never,
    );
    void service;

    await restrito.counts({ statusGroup: 'PENDING', viewer: atendente });

    for (const consulta of consultas) {
      expect(consulta.where).toHaveProperty('OR');
    }
  });
});

describe('fila de atendimento', () => {
  it('conta quantas estão esperando resposta da empresa', async () => {
    const { service, consultas } = montar();

    await service.counts({ viewer: atendente });

    expect(consultas[ESPERANDO].where).toMatchObject({
      waitingSince: { not: null },
    });
  });

  it('o contador de espera sai do próprio filtro antes de contar', async () => {
    const { service, consultas } = montar();

    await service.counts({ waitingOnly: true, viewer: atendente });

    // Sem tirar a si mesmo, ele contaria o que já está filtrado — e o
    // número viraria o tamanho da lista em vez de uma informação nova.
    expect(consultas[ESPERANDO].where).toEqual(
      expect.objectContaining({ waitingSince: { not: null } }),
    );
    // Mas os OUTROS contadores continuam respeitando o filtro de espera.
    expect(consultas[MINHAS].where).toMatchObject({
      waitingSince: { not: null },
      assignedUserId: 'user-ana',
    });
  });

  it('filtrar por espera restringe a lista', async () => {
    const { service, consultas } = montar();

    await service.list({ waitingOnly: true, viewer: atendente });

    expect(consultas[0].where).toMatchObject({ waitingSince: { not: null } });
  });
});
