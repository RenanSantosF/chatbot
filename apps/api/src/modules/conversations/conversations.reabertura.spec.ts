import { ConversationsService } from './conversations.service';

/**
 * O cliente volta a escrever depois de o atendimento ser resolvido.
 *
 * O card é o mesmo — é assim que quem atende vê o que foi combinado antes,
 * como numa conversa de WhatsApp de verdade —, mas o ATENDIMENTO é outro.
 * O relato que originou estes testes: "resolvi, o cliente escreveu de novo
 * e foi direto pro atendente". Ia mesmo: a conversa reabria com o dono da
 * rodada anterior, atribuída e aceita, pulando fila e regras.
 */
function montar(
  estado: {
    anterior?: Record<string, unknown> | null;
    /**
     * A IA tem condição de atender?
     *
     * É a pergunta que o código faz — ao MOTOR, não à tabela. O teste
     * espiava `aiSettings.active && apiKeyEncrypted`, que parecia a mesma
     * coisa e não era: essa conta dá "não" pra empresa que roda com a
     * chave de ambiente e pra que nunca abriu a tela de IA, e nas duas a
     * IA atende normalmente. Espiando a tabela, o teste passava verde
     * enquanto o cliente ficava sem resposta.
     */
    iaAtende?: boolean;
    agrupar?: boolean;
  } = {},
) {
  const atualizacoes: Record<string, unknown>[] = [];
  const notas: Record<string, unknown>[] = [];

  const anterior =
    estado.anterior === undefined
      ? {
          id: 'conversa-1',
          assignedUserId: 'user-1',
          queueId: 'setor-financeiro',
          lastMessageAt: new Date(),
        }
      : estado.anterior;

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        findFirst: jest.fn().mockResolvedValue(anterior),
        update: jest.fn().mockImplementation((args: { data: unknown }) => {
          atualizacoes.push(args.data as Record<string, unknown>);
          return { ...(anterior ?? {}), ...(args.data as object) };
        }),
      },
      message: {
        create: jest.fn().mockImplementation((args: { data: unknown }) => {
          notas.push(args.data as Record<string, unknown>);
          return { id: 'msg-1' };
        }),
      },
    },
  };

  const inboxSettings = {
    get: jest.fn().mockResolvedValue({
      groupByCustomer: estado.agrupar ?? true,
      groupWindowHours: 72,
    }),
  };

  const aiEngine = {
    podeAtender: jest.fn().mockResolvedValue(estado.iaAtende ?? true),
  };

  const service = new ConversationsService(
    prisma as never,
    {} as never,
    { emitToTenant: jest.fn() } as never,
    aiEngine as never,
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

  const reabrir = () =>
    (
      service as unknown as {
        reabrirParaAgrupamento: (id: string) => Promise<unknown>;
      }
    ).reabrirParaAgrupamento('cliente-1');

  return { reabrir, prisma, atualizacoes, notas, aiEngine };
}

describe('a rodada nova na mesma conversa', () => {
  it('reabre o card anterior em vez de criar outro', async () => {
    const { reabrir, atualizacoes } = montar();

    await reabrir();

    expect(atualizacoes[0]).toMatchObject({ status: 'OPEN' });
  });

  it('solta o dono: a rodada nova não nasce na mesa de ninguém', async () => {
    /*
     * Era o defeito relatado. Com o dono mantido, a conversa voltava
     * atribuída E aceita a quem atendeu antes — pulando a fila, as regras
     * de direcionamento e o expediente de quem estava de folga.
     */
    const { reabrir, atualizacoes } = montar();

    await reabrir();

    expect(atualizacoes[0]).toMatchObject({
      assignedUserId: null,
      assignmentAccepted: false,
    });
  });

  it('mantém o SETOR, que é assunto e não dono', async () => {
    // Zerar o setor esconderia o cliente da equipe que sempre o atende.
    // Quando o assunto novo for de outro setor, as regras corrigem no
    // primeiro escalonamento.
    const { reabrir, atualizacoes } = montar();

    await reabrir();

    expect(atualizacoes[0]).not.toHaveProperty('queueId');
  });

  it('apaga o motivo do escalonamento anterior mesmo sem a IA reassumir', async () => {
    // Ele explica por que a rodada PASSADA foi parar com gente; deixá-lo
    // faria o painel contar a história velha na conversa nova.
    const { reabrir, atualizacoes } = montar({ iaAtende: false });

    await reabrir();

    expect(atualizacoes[0]).toMatchObject({
      escalationReason: null,
      escalationSummary: null,
    });
  });

  it('a IA volta pra frente quando está configurada', async () => {
    const { reabrir, atualizacoes } = montar();

    await reabrir();

    expect(atualizacoes[0]).toMatchObject({ aiMode: 'AI_ACTIVE' });
  });

  it('sem IA configurada, o modo continua humano e a conversa vai pra Pendentes', async () => {
    // Sem chave de API, ligar a IA aqui produziria o aviso de
    // indisponibilidade em vez de atendimento.
    const { reabrir, atualizacoes } = montar({ iaAtende: false });

    await reabrir();

    expect(atualizacoes[0]).not.toHaveProperty('aiMode');
    expect(atualizacoes[0]).toMatchObject({ assignedUserId: null });
  });

  it('a nota no histórico diz que a conversa voltou pra fila', async () => {
    // É o que responde, pra quem atendeu antes, por que ela saiu da mesa
    // dele.
    const { reabrir, notas } = montar();

    await reabrir();

    expect(notas[0]).toMatchObject({ senderType: 'SYSTEM' });
    expect(String(notas[0].content)).toContain('devolvido à fila');
  });

  it('sem dono anterior, a nota não fala em fila', async () => {
    const { reabrir, notas } = montar({
      anterior: { id: 'conversa-1', assignedUserId: null, lastMessageAt: new Date() },
    });

    await reabrir();

    expect(String(notas[0].content)).not.toContain('fila');
  });

  it('com o agrupamento desligado, não reabre nada', async () => {
    const { reabrir, prisma } = montar({ agrupar: false });

    await expect(reabrir()).resolves.toBeNull();
    expect(prisma.db.conversation.update).not.toHaveBeenCalled();
  });

  it('sem conversa dentro da janela, não reabre nada', async () => {
    // Quem escreve três meses depois traz outro caso; ressuscitar a
    // conversa antiga só confunde.
    const { reabrir, prisma } = montar({ anterior: null });

    await expect(reabrir()).resolves.toBeNull();
    expect(prisma.db.conversation.update).not.toHaveBeenCalled();
  });
});

/**
 * O relato: "encerro, resolvo, mando mensagem de novo e a IA não responde".
 *
 * Ele estava certo, e a causa era uma pergunta respondida em dois lugares
 * diferentes. Quem decide o modo de uma conversa RECÉM-NASCIDA pergunta ao
 * motor (`podeAtender`); a reabertura refazia a conta na mão, olhando
 * `aiSettings.active && apiKeyEncrypted`.
 *
 * As duas contas discordam em dois casos reais:
 *
 * - empresa que nunca abriu a tela de IA não tem linha em `aiSettings`, e
 *   o resolvedor trata a ausência como LIGADA;
 * - empresa que roda com a chave de ambiente não tem `apiKeyEncrypted`.
 *
 * Nos dois, a conversa nova ganhava IA e a reaberta não — o cliente
 * escrevia e ninguém respondia, nem a IA (desligada ali) nem um atendente
 * (que não tinha motivo pra olhar uma conversa já resolvida).
 */
describe('a IA volta a atender quem escreve depois de resolvido', () => {
  it('pergunta ao MOTOR, e não à tabela de configuração', async () => {
    // É a garantia contra a volta do defeito: qualquer conta refeita na
    // mão aqui dentro passa a divergir do motor de novo.
    const { reabrir, aiEngine, prisma } = montar();

    await reabrir();

    expect(aiEngine.podeAtender).toHaveBeenCalled();
    expect(prisma.db).not.toHaveProperty('aiSettings');
  });

  it('reassume quando o motor diz que a IA atende', async () => {
    const { reabrir, atualizacoes } = montar({ iaAtende: true });

    await reabrir();

    expect(atualizacoes[0]).toMatchObject({ aiMode: 'AI_ACTIVE' });
  });

  it('e não reassume quando o motor diz que não', async () => {
    // Ligar a IA sem ela poder responder produz o aviso de
    // indisponibilidade em vez de atendimento. Continua humano, e a
    // conversa aparece em Pendentes — que é o certo nesse caso.
    const { reabrir, atualizacoes } = montar({ iaAtende: false });

    await reabrir();

    expect(atualizacoes[0]).not.toHaveProperty('aiMode');
  });
});
