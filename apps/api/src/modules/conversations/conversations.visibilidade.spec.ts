import { ConversationsService } from './conversations.service';

/**
 * Quem enxerga o quê no Inbox — e se o cabeçalho concorda com a lista.
 *
 * O recorte por setor é fácil de acertar na lista e esquecer no contador.
 * O efeito é uma tela que se contradiz: "12 pendentes" no alto e cinco
 * conversas embaixo. Quem trabalha ali não tem como saber se as outras
 * sete são de outro setor ou se a página parou de carregar — e a suspeita
 * corrói a confiança na tela inteira.
 */
function montar(opcoes: {
  visibilidade?: 'ALL' | 'OWN_QUEUES';
  setoresDoUsuario?: string[];
}) {
  const wheres: Record<string, unknown>[] = [];

  const registrar = () =>
    jest.fn().mockImplementation((args?: { where?: unknown }) => {
      wheres.push((args?.where ?? {}) as Record<string, unknown>);
      return 0;
    });

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        count: registrar(),
        groupBy: jest.fn().mockImplementation((args?: { where?: unknown }) => {
          wheres.push((args?.where ?? {}) as Record<string, unknown>);
          return [];
        }),
        findMany: jest.fn().mockImplementation((args?: { where?: unknown }) => {
          wheres.push((args?.where ?? {}) as Record<string, unknown>);
          return [];
        }),
      },
      queueMember: {
        findMany: jest.fn().mockResolvedValue(
          (opcoes.setoresDoUsuario ?? ['fila-financeiro']).map((queueId) => ({
            queueId,
          })),
        ),
      },
    },
  };

  const inboxSettings = {
    get: jest
      .fn()
      .mockResolvedValue({ queueVisibility: opcoes.visibilidade ?? 'ALL' }),
  };

  const service = new ConversationsService(
    prisma as never,
    {} as never,
    { emitToTenant: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    inboxSettings as never,
    {} as never,
    {} as never,
    {} as never,
    { transcreverSeAutomatico: jest.fn() } as never,
    { registrar: jest.fn() } as never,
    { avisarEquipe: jest.fn().mockResolvedValue(undefined) } as never,
  );

  return { service, wheres };
}

const atendente = { userId: 'user-ana', role: 'AGENT' as const };

const recorteEsperado = {
  OR: [
    { queueId: null },
    { queueId: { in: ['fila-financeiro'] } },
    { assignedUserId: 'user-ana' },
  ],
};

describe('modo aberto (padrão)', () => {
  it('não recorta nada: equipe pequena trabalha melhor vendo tudo', async () => {
    const { service, wheres } = montar({ visibilidade: 'ALL' });

    await service.list({ viewer: atendente });

    expect(wheres[0]).not.toHaveProperty('OR');
  });

  it('nem consulta os setores do usuário à toa', async () => {
    const { service } = montar({ visibilidade: 'ALL' });
    await service.counts({ viewer: atendente });
    // Só o `get` das configurações; nenhuma consulta de fila.
  });
});

describe('modo por setor', () => {
  it('a lista mostra só setor da pessoa, conversa sem setor e o que é dela', async () => {
    const { service, wheres } = montar({ visibilidade: 'OWN_QUEUES' });

    await service.list({ viewer: atendente });

    expect(wheres[0]).toMatchObject(recorteEsperado);
  });

  it('conversa sem setor nenhum fica visível — senão ficaria sem atendimento', async () => {
    const { service, wheres } = montar({ visibilidade: 'OWN_QUEUES' });

    await service.list({ viewer: atendente });

    expect((wheres[0] as { OR: unknown[] }).OR).toContainEqual({
      queueId: null,
    });
  });

  it('conversa atribuída à própria pessoa continua visível se o setor mudar', async () => {
    const { service, wheres } = montar({ visibilidade: 'OWN_QUEUES' });

    await service.list({ viewer: atendente });

    expect((wheres[0] as { OR: unknown[] }).OR).toContainEqual({
      assignedUserId: 'user-ana',
    });
  });

  it.each(['OWNER', 'ADMIN'] as const)(
    '%s vê tudo: sem isso não dá pra chefiar',
    async (role) => {
      const { service, wheres } = montar({ visibilidade: 'OWN_QUEUES' });

      await service.list({ viewer: { userId: 'user-chefe', role } });

      expect(wheres[0]).not.toHaveProperty('OR');
    },
  );

  it('sem ninguém identificado (webhook, rotina interna), não recorta', async () => {
    const { service, wheres } = montar({ visibilidade: 'OWN_QUEUES' });

    await service.list({});

    expect(wheres[0]).not.toHaveProperty('OR');
  });
});

describe('contadores concordam com a lista', () => {
  it('TODOS os contadores recebem o mesmo recorte da lista', async () => {
    // Este é o defeito: os contadores contavam a empresa inteira enquanto a
    // lista mostrava só o setor.
    const { service, wheres } = montar({ visibilidade: 'OWN_QUEUES' });

    await service.counts({ viewer: atendente });

    // O número é proposital: um contador novo que esqueça o recorte faz
    // este teste falhar em vez de passar despercebido.
    expect(wheres).toHaveLength(11);
    for (const where of wheres) {
      expect(where).toMatchObject(recorteEsperado);
    }
  });

  it('o recorte convive com o filtro próprio de cada contador', async () => {
    const { service, wheres } = montar({ visibilidade: 'OWN_QUEUES' });

    await service.counts({ viewer: atendente });

    expect(wheres).toContainEqual(
      expect.objectContaining({
        ...recorteEsperado,
        unreadCount: { gt: 0 },
      }),
    );
    expect(wheres).toContainEqual(
      expect.objectContaining({
        ...recorteEsperado,
        assignedUserId: 'user-ana',
      }),
    );
  });

  it('no modo aberto os contadores seguem contando tudo', async () => {
    const { service, wheres } = montar({ visibilidade: 'ALL' });

    await service.counts({ viewer: atendente });

    for (const where of wheres) {
      expect(where).not.toHaveProperty('OR');
    }
  });
});
