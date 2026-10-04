import {
  CopilotLeituraService,
  duracao,
  intervaloDoPeriodo,
  meiaNoite,
} from './copilot-leitura.service';

const SP = 'America/Sao_Paulo';

describe('datas no fuso da empresa', () => {
  it('"hoje" em São Paulo começa às 03:00 UTC, não à meia-noite do servidor', () => {
    // 01:30 UTC do dia 10 ainda é 22:30 do dia 9 em São Paulo.
    const agora = new Date('2026-09-10T01:30:00Z');
    expect(meiaNoite(SP, agora).toISOString()).toBe('2026-09-09T03:00:00.000Z');
  });

  it('ontem vai da meia-noite de ontem até a de hoje', () => {
    const agora = new Date('2026-09-10T15:00:00Z');
    const { de, ate } = intervaloDoPeriodo('ontem', SP, agora);
    expect(de.toISOString()).toBe('2026-09-09T03:00:00.000Z');
    expect(ate.toISOString()).toBe('2026-09-10T03:00:00.000Z');
  });

  it('7 dias inclui hoje e os seis anteriores', () => {
    const agora = new Date('2026-09-10T15:00:00Z');
    const { de } = intervaloDoPeriodo('7dias', SP, agora);
    expect(de.toISOString()).toBe('2026-09-04T03:00:00.000Z');
  });

  it('o mês começa no dia 1º, no fuso da empresa', () => {
    const agora = new Date('2026-09-10T15:00:00Z');
    const { de } = intervaloDoPeriodo('mes', SP, agora);
    expect(de.toISOString()).toBe('2026-09-01T03:00:00.000Z');
  });

  it('duração em texto que se lê', () => {
    expect(duracao(20 * 1000)).toBe('menos de 1 min');
    expect(duracao(45 * 60 * 1000)).toBe('45 min');
    expect(duracao(125 * 60 * 1000)).toBe('2 h 5 min');
  });
});

function montar(dados: {
  mensagens?: object[];
  notas?: object[];
  esperando?: object[];
  papel?: 'OWNER' | 'AGENT';
  visibilidade?: 'ALL' | 'OWN_QUEUES';
}) {
  const message = {
    findMany: jest.fn((args: { where: { senderType?: string } }) =>
      Promise.resolve(
        args.where.senderType === 'SYSTEM'
          ? (dados.notas ?? [])
          : (dados.mensagens ?? []),
      ),
    ),
    findFirst: jest.fn().mockResolvedValue(null),
  };
  const prisma = {
    tenantId: 't1',
    db: {
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ timezone: SP, canal: 'EVOLUTION' }),
      },
      message,
      conversation: {
        count: jest.fn().mockResolvedValue(3),
        findMany: jest.fn().mockResolvedValue(dados.esperando ?? []),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'u-ana', name: 'Ana' },
          { id: 'u-bia', name: 'Bia' },
        ]),
      },
      queueMember: {
        findMany: jest.fn().mockResolvedValue([{ queueId: 'q1' }]),
      },
      avaliacaoDeAtendimento: {
        findMany: jest.fn().mockResolvedValue([{ nota: 5 }, { nota: 4 }]),
      },
      evolutionSettings: {
        findFirst: jest.fn().mockResolvedValue({ estado: 'CONECTADO' }),
      },
    },
  };
  const inbox = {
    get: jest
      .fn()
      .mockResolvedValue({ queueVisibility: dados.visibilidade ?? 'ALL' }),
  };
  return {
    service: new CopilotLeituraService(prisma as never, inbox as never),
    prisma,
  };
}

const em = (minutos: number) =>
  new Date(Date.now() - 60 * 60 * 1000 + minutos * 60 * 1000);

describe('relatório', () => {
  it('conta o que a IA resolveu sozinha, o que passou pra equipe e quem atendeu', async () => {
    const { service } = montar({
      mensagens: [
        // c1: só a IA.
        {
          conversationId: 'c1',
          senderType: 'CUSTOMER',
          content: 'oi',
          createdAt: em(0),
        },
        {
          conversationId: 'c1',
          senderType: 'AI',
          content: 'olá',
          createdAt: em(1),
        },
        // c2: a IA passou pra equipe, a Ana respondeu 10 min depois.
        {
          conversationId: 'c2',
          senderType: 'CUSTOMER',
          content: 'preço?',
          createdAt: em(0),
        },
        {
          conversationId: 'c2',
          senderType: 'SYSTEM',
          content: 'IA solicitou atendimento humano: preço não cadastrado',
          createdAt: em(1),
        },
        {
          conversationId: 'c2',
          senderType: 'AGENT',
          senderId: 'u-ana',
          content: 'R$ 800',
          createdAt: em(10),
        },
        // c3: o cliente escreveu e ninguém respondeu.
        {
          conversationId: 'c3',
          senderType: 'CUSTOMER',
          content: 'alô',
          createdAt: em(20),
        },
      ],
    });

    const r = await service.relatorio({ periodo: 'hoje' });

    expect(r.clientesQueEscreveram).toBe(3);
    // c1 e c3: nenhuma das duas passou por gente.
    expect(r.ia.atendeuSozinha).toBe(2);
    expect(r.ia.passouParaAEquipe).toBe(1);
    expect(r.ia.principaisMotivos).toEqual([
      { motivo: 'preço não cadastrado', vezes: 1 },
    ]);
    expect(r.equipe.porAtendente).toEqual([
      {
        nome: 'Ana',
        conversas: 1,
        mensagens: 1,
        tempoMedioDeResposta: '10 min',
      },
    ]);
    expect(r.aindaSemResposta).toBe(1);
  });
});

describe('o que a IA não soube', () => {
  it('traz a pergunta do cliente, o motivo e a resposta que a equipe deu', async () => {
    const { service, prisma } = montar({
      notas: [
        {
          conversationId: 'c2',
          content:
            'IA encaminhou para o setor "Vendas": o cliente pediu o preço do clareamento. Aguardando alguém do setor assumir.',
          createdAt: em(1),
          conversation: { customer: { name: 'João' } },
        },
      ],
      mensagens: [
        {
          content: 'quanto custa o clareamento?',
          messageType: 'TEXT',
          senderType: 'CUSTOMER',
        },
      ],
    });
    prisma.db.message.findFirst.mockResolvedValue({
      content: 'Custa R$ 800, em até 3x.',
      messageType: 'TEXT',
      senderType: 'AGENT',
    });

    const r = await service.perguntasQueAIaNaoSoube({ periodo: '7dias' });

    expect(r.itens).toEqual([
      expect.objectContaining({
        cliente: 'João',
        motivo: 'o cliente pediu o preço do clareamento',
        perguntaDoCliente: 'quanto custa o clareamento?',
        respostaDaEquipe: 'Custa R$ 800, em até 3x.',
      }),
    ]);
  });

  it('IA desligada ou sem cota não é dúvida — não há o que ensinar', async () => {
    const { service } = montar({
      notas: [
        {
          conversationId: 'c9',
          content:
            'Encaminhado para a equipe: O atendimento automático está desligado e o cliente está esperando.',
          createdAt: em(1),
          conversation: { customer: { name: 'Maria' } },
        },
      ],
    });

    const r = await service.perguntasQueAIaNaoSoube({});
    expect(r.itens).toEqual([]);
  });
});

describe('avisos do ✨', () => {
  it('avisa quem espera há mais de 30 minutos', async () => {
    const { service } = montar({
      esperando: [{ waitingSince: em(0) }, { waitingSince: em(10) }],
    });

    const { avisos } = await service.avisos(
      { userId: 'u1', role: 'OWNER' },
      false,
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0].texto).toMatch(/^2 clientes esperando/);
  });

  it('três transferências pelo mesmo motivo viram sugestão de ensinar', async () => {
    const nota = (id: string) => ({
      conversationId: id,
      content: 'IA solicitou atendimento humano: preço não cadastrado',
    });
    const { service } = montar({ notas: [nota('a'), nota('b'), nota('c')] });

    const { avisos } = await service.avisos(
      { userId: 'u1', role: 'OWNER' },
      true,
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0].texto).toMatch(
      /3 conversas pra equipe hoje pelo mesmo motivo/,
    );
  });

  it('nada fora do normal: nenhum aviso (e nenhum pontinho)', async () => {
    const { service } = montar({});
    const { avisos } = await service.avisos(
      { userId: 'u1', role: 'OWNER' },
      true,
    );
    expect(avisos).toEqual([]);
  });
});

describe('o assistente não fura o recorte de setor', () => {
  it('atendente com visibilidade restrita só enxerga os próprios setores', async () => {
    const { service } = montar({
      papel: 'AGENT',
      visibilidade: 'OWN_QUEUES',
    });
    expect(await service.visiveis({ userId: 'u1', role: 'AGENT' })).toEqual({
      OR: [
        { queueId: null },
        { queueId: { in: ['q1'] } },
        { assignedUserId: 'u1' },
      ],
    });
  });

  it('dono enxerga tudo', async () => {
    const { service } = montar({ visibilidade: 'OWN_QUEUES' });
    expect(await service.visiveis({ userId: 'u1', role: 'OWNER' })).toEqual({});
  });
});
