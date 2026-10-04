import { MetricsService } from './metrics.service';

/**
 * A Visão geral.
 *
 * É a tela em que ninguém percebe que o número está errado — não há com o
 * que comparar. Um dia faltando na linha do tempo ou um tempo de resposta
 * contado errado passa como verdade e vira decisão de contratação.
 */
function servicoCom(dados: {
  conversas?: Record<string, unknown>[];
  mensagens?: Record<string, unknown>[];
  notas?: number[];
}) {
  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        findMany: jest.fn().mockResolvedValue(dados.conversas ?? []),
      },
      message: { findMany: jest.fn().mockResolvedValue(dados.mensagens ?? []) },
      avaliacaoDeAtendimento: {
        findMany: jest
          .fn()
          .mockResolvedValue((dados.notas ?? []).map((nota) => ({ nota }))),
      },
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ timezone: 'America/Sao_Paulo' }),
      },
    },
  };

  return new MetricsService(prisma as never);
}

const em = (iso: string) => new Date(iso);

describe('linha do tempo por dia', () => {
  it('semeia os dias vazios pra a linha não pular buraco', async () => {
    const service = servicoCom({});

    const { byDay } = await service.overview({
      from: em('2026-08-01T00:00:00Z'),
      to: em('2026-08-03T23:59:59Z'),
    });

    expect(byDay.map((d) => d.day)).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
  });

  it('não perde o último dia quando o período não fecha em hora redonda', async () => {
    // O defeito: somando 24h a partir de um horário quebrado, o laço parava
    // antes do último dia sempre que o fim caía mais cedo no relógio que o
    // começo. O dia existia, tinha movimento, e sumia do gráfico — as
    // mensagens dele caíam num balde inexistente e eram descartadas.
    const service = servicoCom({
      mensagens: [
        {
          conversationId: 'c1',
          senderType: 'AI',
          createdAt: em('2026-08-05T09:00:00Z'),
        },
      ],
    });

    const { byDay } = await service.overview({
      from: em('2026-08-01T13:00:00Z'),
      to: em('2026-08-05T12:00:00Z'),
    });

    expect(byDay.map((d) => d.day)).toContain('2026-08-05');
    expect(byDay.find((d) => d.day === '2026-08-05')?.messages).toBe(1);
  });

  it('conta conversa e mensagem no dia certo', async () => {
    const service = servicoCom({
      conversas: [
        {
          id: 'c1',
          status: 'OPEN',
          assignedUserId: null,
          createdAt: em('2026-08-02T10:00:00Z'),
        },
        {
          id: 'c2',
          status: 'OPEN',
          assignedUserId: null,
          createdAt: em('2026-08-02T22:00:00Z'),
        },
      ],
      mensagens: [
        {
          conversationId: 'c1',
          senderType: 'CUSTOMER',
          createdAt: em('2026-08-03T08:00:00Z'),
        },
      ],
    });

    const { byDay } = await service.overview({
      from: em('2026-08-01T00:00:00Z'),
      to: em('2026-08-03T23:59:59Z'),
    });

    expect(byDay).toEqual([
      { day: '2026-08-01', conversations: 0, messages: 0 },
      { day: '2026-08-02', conversations: 2, messages: 0 },
      { day: '2026-08-03', conversations: 0, messages: 1 },
    ]);
  });
});

describe('o dia no relógio da empresa', () => {
  it('a mensagem das 22h de São Paulo conta no mesmo dia, não no seguinte', async () => {
    // 22h em São Paulo já é 01h do dia seguinte em UTC.
    const service = servicoCom({
      mensagens: [
        {
          conversationId: 'c1',
          senderType: 'CUSTOMER',
          createdAt: em('2026-08-03T01:00:00Z'),
        },
      ],
    });

    const periodo = await service.periodo('2026-08-01', '2026-08-02');
    const { byDay } = await service.overview(periodo, periodo.fuso);

    expect(byDay).toEqual([
      { day: '2026-08-01', conversations: 0, messages: 0 },
      { day: '2026-08-02', conversations: 0, messages: 1 },
    ]);
  });

  it('o período vai da meia-noite à meia-noite de São Paulo', async () => {
    const service = servicoCom({});

    const { from, to } = await service.periodo('2026-08-01', '2026-08-02');

    expect(from.toISOString()).toBe('2026-08-01T03:00:00.000Z');
    expect(to.toISOString()).toBe('2026-08-03T02:59:59.999Z');
  });

  it('data torta cai no padrão em vez de quebrar a tela', async () => {
    const service = servicoCom({});

    const { from, to } = await service.periodo('ontem', 'xyz');

    expect(to.getTime()).toBeGreaterThan(from.getTime());
  });
});

describe('avaliações do atendimento', () => {
  it('média com uma casa e contagem por nota', async () => {
    const service = servicoCom({ notas: [5, 5, 4, 3] });

    const { avaliacoes } = await service.overview({
      from: em('2026-08-01T00:00:00Z'),
      to: em('2026-08-03T23:59:59Z'),
    });

    expect(avaliacoes).toEqual({
      total: 4,
      media: 4.3,
      porNota: [0, 0, 1, 1, 2],
    });
  });

  it('sem nenhuma nota, a média é nula (e não zero)', async () => {
    const { avaliacoes } = await servicoCom({}).overview({
      from: em('2026-08-01T00:00:00Z'),
      to: em('2026-08-03T23:59:59Z'),
    });
    expect(avaliacoes.media).toBeNull();
  });
});

describe('totais', () => {
  it('separa o que a IA resolveu sozinha do que passou por gente', async () => {
    // "Resolvida só pela IA" = fechou sem nunca ter caído no colo de
    // ninguém. Se um atendente assumiu em algum momento, não conta.
    const service = servicoCom({
      conversas: [
        {
          id: 'c1',
          status: 'RESOLVED',
          assignedUserId: null,
          createdAt: em('2026-08-01T10:00:00Z'),
        },
        {
          id: 'c2',
          status: 'CLOSED',
          assignedUserId: 'user-ana',
          createdAt: em('2026-08-01T10:00:00Z'),
        },
        {
          id: 'c3',
          status: 'OPEN',
          assignedUserId: null,
          createdAt: em('2026-08-01T10:00:00Z'),
        },
      ],
    });

    const { totals } = await service.overview({
      from: em('2026-08-01T00:00:00Z'),
      to: em('2026-08-01T23:59:59Z'),
    });

    expect(totals).toMatchObject({
      conversations: 3,
      resolvedByAi: 1,
      resolvedByHuman: 1,
    });
  });
});

describe('tempo de resposta', () => {
  const janela = {
    from: em('2026-08-01T00:00:00Z'),
    to: em('2026-08-01T23:59:59Z'),
  };

  it('conta do momento da pergunta até a primeira resposta', async () => {
    const service = servicoCom({
      mensagens: [
        {
          conversationId: 'c1',
          senderType: 'CUSTOMER',
          createdAt: em('2026-08-01T10:00:00Z'),
        },
        {
          conversationId: 'c1',
          senderType: 'AI',
          createdAt: em('2026-08-01T10:00:30Z'),
        },
      ],
    });

    const { responseTime } = await service.overview(janela);

    expect(responseTime.aiSeconds).toBe(30);
    expect(responseTime.answered).toBe(1);
  });

  it('três mensagens seguidas do cliente contam a partir da primeira', async () => {
    // É o comportamento honesto: o cliente esperou desde que perguntou, não
    // desde que repetiu a pergunta.
    const service = servicoCom({
      mensagens: [
        {
          conversationId: 'c1',
          senderType: 'CUSTOMER',
          createdAt: em('2026-08-01T10:00:00Z'),
        },
        {
          conversationId: 'c1',
          senderType: 'CUSTOMER',
          createdAt: em('2026-08-01T10:00:20Z'),
        },
        {
          conversationId: 'c1',
          senderType: 'CUSTOMER',
          createdAt: em('2026-08-01T10:00:40Z'),
        },
        {
          conversationId: 'c1',
          senderType: 'AGENT',
          createdAt: em('2026-08-01T10:01:00Z'),
        },
      ],
    });

    const { responseTime } = await service.overview(janela);

    expect(responseTime.humanSeconds).toBe(60);
  });

  it('nota do sistema não conta como resposta', async () => {
    // Um aviso de transferência não é alguém falando com o cliente; contar
    // isso faria o tempo de resposta parecer ótimo sem ninguém responder.
    const service = servicoCom({
      mensagens: [
        {
          conversationId: 'c1',
          senderType: 'CUSTOMER',
          createdAt: em('2026-08-01T10:00:00Z'),
        },
        {
          conversationId: 'c1',
          senderType: 'SYSTEM',
          createdAt: em('2026-08-01T10:00:05Z'),
        },
        {
          conversationId: 'c1',
          senderType: 'AGENT',
          createdAt: em('2026-08-01T10:02:00Z'),
        },
      ],
    });

    const { responseTime } = await service.overview(janela);

    expect(responseTime.humanSeconds).toBe(120);
  });

  it('conta as perguntas que ficaram sem resposta nenhuma', async () => {
    const service = servicoCom({
      mensagens: [
        {
          conversationId: 'c1',
          senderType: 'CUSTOMER',
          createdAt: em('2026-08-01T10:00:00Z'),
        },
        {
          conversationId: 'c2',
          senderType: 'CUSTOMER',
          createdAt: em('2026-08-01T11:00:00Z'),
        },
        {
          conversationId: 'c2',
          senderType: 'AI',
          createdAt: em('2026-08-01T11:00:10Z'),
        },
      ],
    });

    const { responseTime } = await service.overview(janela);

    expect(responseTime.unanswered).toBe(1);
    expect(responseTime.answered).toBe(1);
  });

  it('não mistura conversas diferentes', async () => {
    const service = servicoCom({
      mensagens: [
        {
          conversationId: 'c1',
          senderType: 'CUSTOMER',
          createdAt: em('2026-08-01T10:00:00Z'),
        },
        {
          conversationId: 'c2',
          senderType: 'AGENT',
          createdAt: em('2026-08-01T10:00:05Z'),
        },
      ],
    });

    const { responseTime } = await service.overview(janela);

    expect(responseTime.answered).toBe(0);
    expect(responseTime.unanswered).toBe(1);
  });

  it('sem movimento, devolve nulo em vez de zero', async () => {
    // Zero segundos de resposta é uma afirmação forte e falsa; "não houve"
    // é o que a tela precisa saber pra mostrar um traço.
    const service = servicoCom({});

    const { responseTime } = await service.overview(janela);

    expect(responseTime.aiSeconds).toBeNull();
    expect(responseTime.overallSeconds).toBeNull();
  });
});
