import { AiContextBuilder } from './ai-context-builder.service';

/**
 * Encerrar um atendimento é uma fronteira de contexto.
 *
 * O defeito que originou isto: a IA passou um caso para o Jurídico, o
 * atendimento foi encerrado, o cliente voltou dias depois com um "Oi" — e a
 * IA leu o pedido antigo lá em cima e refez a transferência. Da parte dela
 * era coerente; para quem estava do outro lado, era um sistema que não
 * percebeu que aquilo já tinha terminado.
 *
 * O que se protege aqui é o RECORTE: da reabertura pra frente, e não a
 * conversa inteira. Se alguém remover o filtro achando que "mais contexto é
 * sempre melhor", é este arquivo que avisa.
 */
/** Extrai o `where` da primeira consulta feita — tipado, pro lint não reclamar. */
function pegarWhere(consulta: jest.Mock): { createdAt?: { gte: Date } } {
  const chamada = consulta.mock.calls[0] as [
    { where: { createdAt?: { gte: Date } } },
  ];
  return chamada[0].where;
}

function construtorCom(opcoes: {
  reabertura?: { createdAt: Date } | null;
  mensagens?: unknown[];
}) {
  const findFirst = jest.fn().mockResolvedValue(opcoes.reabertura ?? null);
  const findMany = jest.fn().mockResolvedValue(opcoes.mensagens ?? []);

  const tenantPrisma = {
    tenantId: 'tenant-teste',
    db: {
      message: { findFirst, findMany },
      aiSettings: { findFirst: jest.fn().mockResolvedValue(null) },
      aiInstruction: { findMany: jest.fn().mockResolvedValue([]) },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ customer: { metadata: {} } }),
      },
    },
  };

  const service = new AiContextBuilder(
    // O primeiro é o PrismaService global (usado só pro nome do tenant); o
    // segundo é o escopado por empresa, que é o que este teste observa.
    {
      client: {
        tenant: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ name: 'Empresa Teste' }),
        },
      },
    } as never,
    tenantPrisma as never,
    { searchRelevantChunks: jest.fn().mockResolvedValue([]) } as never,
    { missingRequired: jest.fn().mockResolvedValue([]) } as never,
    { expediente: jest.fn().mockResolvedValue({}) } as never,
  );

  return { service, findFirst, findMany };
}

describe('contexto que a IA enxerga', () => {
  it('lê só da reabertura pra frente quando o atendimento já foi encerrado', async () => {
    const reabertoEm = new Date('2026-08-14T10:00:00Z');
    const { service, findMany } = construtorCom({
      reabertura: { createdAt: reabertoEm },
    });

    await service.build('conversa-1');

    const where = pegarWhere(findMany);
    expect(where.createdAt?.gte).toEqual(reabertoEm);
  });

  it('lê a conversa inteira quando ela nunca foi encerrada', async () => {
    // Sem fronteira não há o que recortar: um atendimento que segue desde o
    // começo precisa do histórico todo pra IA não perder o fio.
    const { service, findMany } = construtorCom({ reabertura: null });

    await service.build('conversa-1');

    const where = pegarWhere(findMany);
    expect(where.createdAt).toBeUndefined();
  });

  it('procura a reabertura MAIS RECENTE', async () => {
    // Conversa que foi encerrada e reaberta três vezes tem três notas. A
    // que vale é a última — as anteriores pertencem a atendimentos que
    // também já terminaram.
    const { service, findFirst } = construtorCom({
      reabertura: { createdAt: new Date() },
    });

    await service.build('conversa-1');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        where: expect.objectContaining({ senderType: 'SYSTEM' }) as object,
      }) as object,
    );
  });

  it('não deixa aviso do sistema virar fala da IA', async () => {
    // As notas ("Fulano assumiu", "encaminhado para a equipe") são para o
    // painel, não para o modelo: tratá-las como turno de conversa faria a
    // IA responder a elas.
    const { service } = construtorCom({
      reabertura: null,
      mensagens: [
        { senderType: 'CUSTOMER', content: 'oi', createdAt: new Date() },
        {
          senderType: 'SYSTEM',
          content: 'Fulano assumiu.',
          createdAt: new Date(),
        },
        { senderType: 'AI', content: 'olá!', createdAt: new Date() },
      ],
    });

    const { history } = await service.build('conversa-1');

    expect(history).toHaveLength(2);
    expect(history.map((m) => m.content)).not.toContain('Fulano assumiu.');
  });
});
