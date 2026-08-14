import { AiToolsService } from './ai-tools.service';

/**
 * Pra onde a conversa vai quando a IA pede um humano.
 *
 * A regra que estes testes guardam saiu de uma pergunta de quem usou: "a
 * IA transferiu pro setor Jurídico, por que apareceu 'Responsável: Lucas'?"
 * Ninguém tinha escolhido o Lucas — o rodízio da fila escolheu, e ele virou
 * responsável por um caso que nunca aceitou.
 *
 * Duas frases resolvem:
 *
 * 1. Setor não é pessoa. A IA dizendo "isto é do Jurídico" não é a mesma
 *    coisa que "isto é da Ana do Jurídico".
 * 2. Nomear pessoa é indicação, nunca decisão. Quando a máquina escolhe
 *    alguém, essa pessoa aceita antes de virar responsável.
 */
function servicoCom(
  opcoes: {
    fila?: { id: string; name: string } | null;
    regra?: {
      ruleName: string;
      queueId: string | null;
      assignedUserId: string | null;
    } | null;
    camposFaltando?: string[];
  } = {},
) {
  const escritas: Record<string, unknown>[] = [];
  const notas: string[] = [];

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        update: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) => {
            escritas.push(args.data);
            return { id: 'conversa-1', messages: [] };
          }),
      },
      message: {
        create: jest
          .fn()
          .mockImplementation((args: { data: { content: string } }) => {
            notas.push(args.data.content);
            return {};
          }),
      },
      aiTool: {
        findFirst: jest.fn().mockResolvedValue({ permission: 'AUTO' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      aiSettings: {
        findFirst: jest.fn().mockResolvedValue({ memoryMode: 'NONE' }),
      },
    },
  };

  const queues = {
    findByKey: jest.fn().mockResolvedValue(opcoes.fila ?? null),
    findById: jest.fn().mockResolvedValue(opcoes.fila ?? null),
    pickNextMember: jest.fn().mockResolvedValue('user-lucas'),
  };
  const routing = {
    resolveTarget: jest.fn().mockResolvedValue(opcoes.regra ?? null),
  };
  const collection = {
    missingRequired: jest.fn().mockResolvedValue(opcoes.camposFaltando ?? []),
  };

  const service = new AiToolsService(
    prisma as never,
    { emitToTenant: jest.fn() } as never,
    queues as never,
    routing as never,
    collection as never,
  );

  return { service, escritas, notas, queues };
}

const transferir = (service: AiToolsService, args: Record<string, unknown>) =>
  service.execute('transferToQueue', args, 'conversa-1');

const pedido = {
  reason: 'Cliente solicitou falar com um advogado',
  summary: 'O cliente entrou em contato pedindo um advogado.',
};

describe('a IA escolhe um SETOR', () => {
  const juridico = { id: 'fila-juridico', name: 'Jurídico' };

  it('não carimba responsável — quem estiver livre pega', async () => {
    // O defeito relatado: o rodízio da fila escolhia alguém e a conversa
    // aparecia com o nome de uma pessoa que nunca foi consultada.
    const { service, escritas } = servicoCom({ fila: juridico });

    await transferir(service, { ...pedido, queueKey: 'juridico' });

    expect(escritas[0].assignedUserId).toBeNull();
    expect(escritas[0].queueId).toBe('fila-juridico');
  });

  it('nem roda o rodízio da fila', async () => {
    const { service, queues } = servicoCom({ fila: juridico });

    await transferir(service, { ...pedido, queueKey: 'juridico' });

    expect(queues.pickNextMember).not.toHaveBeenCalled();
  });

  it('a conversa fica aguardando o setor, não uma pessoa', async () => {
    const { service, escritas } = servicoCom({ fila: juridico });

    await transferir(service, { ...pedido, queueKey: 'juridico' });

    expect(escritas[0]).toMatchObject({
      status: 'WAITING_AGENT',
      aiMode: 'HUMAN_ACTIVE',
      // Nada a aceitar: ninguém foi nomeado.
      assignmentAccepted: true,
    });
  });

  it('a nota diz que o setor precisa assumir', async () => {
    const { service, notas } = servicoCom({ fila: juridico });

    await transferir(service, { ...pedido, queueKey: 'juridico' });

    expect(notas[0]).toContain('Jurídico');
    expect(notas[0]).toContain('assumir');
  });
});

describe('uma REGRA do dono nomeia a pessoa', () => {
  const regraDoPlantao = {
    ruleName: 'Plantão',
    queueId: null,
    assignedUserId: 'user-plantonista',
  };

  it('a pessoa é indicada, e a indicação espera aceite', async () => {
    // Aqui a escolha foi do dono, não do modelo — mas continua sendo
    // indicação: ninguém deve acordar dono de um caso que não aceitou.
    const { service, escritas } = servicoCom({ regra: regraDoPlantao });

    await transferir(service, pedido);

    expect(escritas[0]).toMatchObject({
      assignedUserId: 'user-plantonista',
      assignmentAccepted: false,
    });
  });

  it('a nota avisa que falta o aceite', async () => {
    const { service, notas } = servicoCom({ regra: regraDoPlantao });

    await transferir(service, pedido);

    expect(notas[0]).toContain('Plantão');
    expect(notas[0]).toContain('aceite');
  });

  it('a regra vence a fila que a IA sugeriu', async () => {
    // A regra é a decisão explícita do dono sobre quem atende o quê; a
    // fila escolhida pelo modelo é palpite.
    const { service, escritas, queues } = servicoCom({
      fila: { id: 'fila-juridico', name: 'Jurídico' },
      regra: regraDoPlantao,
    });

    await transferir(service, {
      ...pedido,
      queueKey: 'juridico',
      ruleKey: 'plantao',
    });

    expect(escritas[0].assignedUserId).toBe('user-plantonista');
    expect(queues.findByKey).not.toHaveBeenCalled();
  });
});

describe('sem fila e sem regra', () => {
  it('pede gente sem apontar pra lugar nenhum', async () => {
    const { service, escritas, notas } = servicoCom({ fila: null });

    await transferir(service, pedido);

    expect(escritas[0]).toMatchObject({
      status: 'WAITING_AGENT',
      assignedUserId: null,
    });
    expect(notas[0]).toContain('atendimento humano');
  });
});

describe('a barreira de coleta continua valendo', () => {
  it('sem os dados obrigatórios, não transfere nada', async () => {
    const { service, escritas } = servicoCom({
      fila: { id: 'fila-juridico', name: 'Jurídico' },
      camposFaltando: ['CPF'],
    });

    const resultado = await transferir(service, {
      ...pedido,
      queueKey: 'juridico',
    });

    expect(escritas).toEqual([]);
    expect(resultado.output).toMatchObject({
      status: 'blocked',
      missing: ['CPF'],
    });
  });
});
