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
    {} as never,
    { transcreverSeAutomatico: jest.fn() } as never,
    { registrar: jest.fn() } as never,
    { avisarEquipe: jest.fn().mockResolvedValue(undefined) } as never,
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
      {} as never,
      { transcreverSeAutomatico: jest.fn() } as never,
      { registrar: jest.fn() } as never,
      { avisarEquipe: jest.fn().mockResolvedValue(undefined) } as never,
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

/** Onde os dois últimos contadores caem na fila de consultas. */
const GRUPOS = 8;
const COM_IA = 9;

describe('conversa que a IA está conduzindo', () => {
  it('não aparece em Pendentes: não está esperando ninguém da equipe', async () => {
    // O relato: o atendente abria conversa por conversa pra descobrir que
    // a IA já tinha respondido e não havia nada a fazer. Num dia
    // movimentado isso enterra quem realmente precisa de gente.
    const { service, consultas } = montar();

    await service.list({ statusGroup: 'PENDING', viewer: atendente });

    expect(consultas[0].where).toMatchObject({
      aiMode: { not: 'AI_ACTIVE' },
    });
  });

  it('"Com a IA" mostra justamente essas, mesmo dentro de Pendentes', async () => {
    // Os dois botões podem ficar ligados ao mesmo tempo na tela. Se a
    // exclusão continuasse valendo, a lista seria vazia sempre — um
    // recorte impossível que dá pra montar com dois cliques.
    const { service, consultas } = montar();

    await service.list({
      statusGroup: 'PENDING',
      comIa: true,
      viewer: atendente,
    });

    expect(consultas[0].where).toMatchObject({ aiMode: 'AI_ACTIVE' });
  });

  it('fora de Pendentes ela não é escondida', async () => {
    // "Tudo" e "Resolvidas" respondem outra pergunta: o que existe, não o
    // que precisa de mim agora.
    const { service, consultas } = montar();

    await service.list({ statusGroup: 'DONE', viewer: atendente });

    expect(consultas[0].where).not.toHaveProperty('aiMode');
  });

  it('o contador de Pendentes exclui a IA igual à lista', async () => {
    // Contador que não bate com a lista embaixo é pior que contador
    // nenhum: quem lê não tem como saber qual dos dois está errado.
    const { service, consultas } = montar();

    await service.counts({ statusGroup: 'PENDING', viewer: atendente });

    expect(consultas[PENDENTES].where).toMatchObject({
      aiMode: { not: 'AI_ACTIVE' },
    });
  });

  it('o contador "Com a IA" sai do próprio filtro antes de contar', async () => {
    const { service, consultas } = montar();

    await service.counts({ statusGroup: 'PENDING', viewer: atendente });

    // Mantém a situação escolhida (é "quantas pendentes a IA conduz"),
    // mas sem a exclusão que ele mesmo causa — senão daria zero sempre.
    expect(consultas[COM_IA].where).toMatchObject({
      aiMode: 'AI_ACTIVE',
      status: { in: ['OPEN', 'WAITING_AGENT', 'WAITING_CUSTOMER'] },
    });
  });
});

/**
 * A quinta aba: os grupos do WhatsApp.
 *
 * As cinco abas são UM eixo — clicar em qualquer uma leva pra ela e sai de
 * onde estava. Por isso cada número tem que responder "quantas eu veria se
 * clicasse aqui", inclusive atravessando as duas caixas.
 */
describe('a aba de grupos e a de clientes são o mesmo eixo', () => {
  it('cliente e grupo nunca aparecem na mesma lista', async () => {
    const { service, consultas } = montar();

    await service.list({ viewer: atendente });
    expect(consultas[0].where).toMatchObject({
      customer: { is: { isGroup: false } },
    });

    consultas.length = 0;
    await service.list({ grupos: true, viewer: atendente });
    expect(consultas[0].where).toMatchObject({
      customer: { is: { isGroup: true } },
    });
  });

  it('a busca acontece DENTRO da caixa aberta', async () => {
    /*
     * As duas condições falam do mesmo `customer`, e enquanto moravam em
     * spreads separados a busca apagava a caixa em silêncio: bastava
     * digitar qualquer coisa pra a aba de clientes começar a devolver
     * grupo — e a de grupos, cliente.
     */
    const { service, consultas } = montar();

    await service.list({ grupos: true, search: 'Ana', viewer: atendente });

    const cliente = consultas[0].where.customer as {
      is: { isGroup: boolean; OR: unknown[] };
    };
    expect(cliente.is.isGroup).toBe(true);
    expect(cliente.is.OR).toHaveLength(2);
  });

  it('as quatro abas de situação contam CLIENTES mesmo estando nos grupos', async () => {
    // Clicar em "Pendentes" a partir dos grupos volta pros clientes. Se o
    // número contasse dentro dos grupos, as quatro abas zerariam assim que
    // a de Grupos fosse aberta — e ninguém clica num "Pendentes 0".
    const { service, consultas } = montar();

    await service.counts({ grupos: true, viewer: atendente });

    for (const indice of [TOTAL, PENDENTES]) {
      expect(consultas[indice].where).toMatchObject({
        customer: { is: { isGroup: false } },
      });
    }
  });

  it('a aba de grupos conta grupos, e sem situação nenhuma', async () => {
    // Grupo não fica pendente nem aguardando (ver `receiveInbound`), então
    // um recorte de situação aqui contaria sempre zero.
    const { service, consultas } = montar();

    await service.counts({ statusGroup: 'PENDING', viewer: atendente });

    expect(consultas[GRUPOS].where).toMatchObject({
      customer: { is: { isGroup: true } },
    });
    expect(consultas[GRUPOS].where).not.toHaveProperty('status');
  });

  it('a fila de espera não reordena os grupos', async () => {
    /*
     * `waitingSince` de grupo é sempre nulo. Na ordem por espera, a aba
     * inteira empatava e caía no desempate por `id` — ou seja, embaralhada,
     * com o grupo que acabou de receber mensagem em qualquer posição.
     */
    const { service } = montar();
    const findMany = (
      service as unknown as {
        prisma: { db: { conversation: { findMany: jest.Mock } } };
      }
    ).prisma.db.conversation.findMany;

    await service.list({ grupos: true, ordem: 'ESPERA', viewer: atendente });

    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { lastMessageAt: 'desc' },
      { id: 'desc' },
    ]);
  });
});
