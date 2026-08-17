import { ConversationsService } from './conversations.service';

/**
 * A resposta que existe pra quem ainda não tem IA.
 *
 * É o primeiro contato do cliente com a empresa no produto, e o que
 * separa "recebemos sua mensagem" de um número que parece abandonado.
 * Também é o recurso mais fácil de transformar em robô chato: mandado na
 * hora errada, ele responde a mesma coisa três vezes seguidas.
 */
function montar(estado: {
  greetingEnabled?: boolean;
  greetingMessage?: string;
  aiMode?: string;
  conversaAberta?: Record<string, unknown> | null;
} = {}) {
  const conversa = {
    id: 'conversa-1',
    channel: 'WHATSAPP',
    aiMode: estado.aiMode ?? 'HUMAN_ACTIVE',
    customer: { id: 'cliente-1', phone: '5527999998888', name: 'Ana' },
    messages: [],
    tags: [],
  };

  const criadas: Record<string, unknown>[] = [];
  const atualizacoes: Record<string, unknown>[] = [];

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        findFirst: jest.fn().mockImplementation((args: { select?: Record<string, unknown> }) => {
          if (args?.select && 'status' in args.select) {
            return { status: 'OPEN', aiMode: conversa.aiMode };
          }
          if (args?.select && 'assignedUserId' in args.select) {
            return { assignedUserId: 'user-1', assignmentAccepted: true, aiMode: 'HUMAN_ACTIVE' };
          }
          return estado.conversaAberta !== undefined ? estado.conversaAberta : null;
        }),
        create: jest.fn().mockResolvedValue(conversa),
        update: jest.fn().mockImplementation((args: { data: unknown }) => {
          atualizacoes.push(args.data as Record<string, unknown>);
          return { ...conversa, ...(args.data as object) };
        }),
      },
      message: {
        create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
          criadas.push(args.data);
          return { id: `msg-${criadas.length}`, createdAt: new Date(), ...args.data };
        }),
        update: jest.fn().mockImplementation((args: { data: unknown }) => ({
          id: 'msg-1',
          ...(args.data as object),
        })),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cliente-1' }) },
      user: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    },
  };

  const whatsapp = {
    enviarTexto: jest.fn().mockResolvedValue('wamid.SAUDACAO'),
    marcarComoLida: jest.fn(),
    motivoDaUltimaFalha: null,
  };

  const inboxSettings = {
    get: jest.fn().mockResolvedValue({
      showAgentName: false,
      greetingEnabled: estado.greetingEnabled ?? true,
      greetingMessage:
        estado.greetingMessage ?? 'Olá! Um atendente já vai falar com você.',
    }),
  };

  const service = new ConversationsService(
    prisma as never,
    { findOrCreateByPhone: jest.fn().mockResolvedValue({ id: 'cliente-1' }) } as never,
    { emitToTenant: jest.fn() } as never,
    // Devolve algo com forma de resultado: o teste da IA ativa só quer
    // saber que a saudação NÃO saiu, mas o fluxo segue lendo a resposta.
    { generateReply: jest.fn().mockResolvedValue({ tipo: 'nao_respondeu' }) } as never,
    whatsapp as never,
    {} as never,
    inboxSettings as never,
    {} as never,
    {} as never,
    {} as never,
    { transcreverSeAutomatico: jest.fn() } as never,
    { registrar: jest.fn() } as never,
  );

  return { service, whatsapp, criadas, atualizacoes };
}

async function receber(service: ConversationsService) {
  await service.receiveInbound({
    customerPhone: '5527999998888',
    customerName: 'Ana',
    content: 'bom dia, preciso de ajuda',
    channel: 'WHATSAPP',
    externalId: 'wamid.CLIENTE',
  });
}

describe('saudação automática', () => {
  it('responde ao cliente na abertura da conversa', async () => {
    const { service, whatsapp } = montar();

    await receber(service);

    expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
      '5527999998888',
      'Olá! Um atendente já vai falar com você.',
      undefined,
    );
  });

  it('fica calada quando a empresa não ligou', async () => {
    // Mandar texto em nome de alguém é escolha dessa pessoa.
    const { service, whatsapp } = montar({ greetingEnabled: false });

    await receber(service);

    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('exige um sim explícito, não só a ausência de não', async () => {
    // É o único lugar que manda texto ao cliente sem ninguém clicar em
    // nada. Valor que chega como texto, ou ausente de um cliente Prisma
    // defasado, não pode ser lido como permissão.
    const { service, whatsapp } = montar({
      greetingEnabled: 'sim' as unknown as boolean,
    });

    await receber(service);

    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('não fala junto com a IA', async () => {
    // Seriam duas boas-vindas seguidas, com palavras diferentes, dizendo a
    // mesma coisa.
    const { service, whatsapp } = montar({ aiMode: 'AI_ACTIVE' });

    await receber(service);

    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('não se repete numa conversa que já existia', async () => {
    // O cliente que manda três perguntas seguidas receberia três avisos
    // iguais — que é como um recurso de cortesia vira robô chato.
    const { service, whatsapp } = montar({
      conversaAberta: {
        id: 'conversa-1',
        channel: 'WHATSAPP',
        aiMode: 'HUMAN_ACTIVE',
        customer: { id: 'cliente-1', phone: '5527999998888', name: 'Ana' },
        messages: [],
        tags: [],
      },
    });

    await receber(service);

    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('deixa a conversa na fila de quem precisa de resposta', async () => {
    // Como AGENT comum, ela viraria "aguardando cliente" um segundo
    // depois de a pessoa escrever — fora da fila de atendimento.
    const { service, atualizacoes } = montar();

    await receber(service);

    for (const dados of atualizacoes) {
      expect(dados.status).not.toBe('WAITING_CUSTOMER');
    }
  });

  it('não zera o contador de não lidas da equipe', async () => {
    const { service, atualizacoes } = montar();

    await receber(service);

    expect(atualizacoes.some((d) => d.unreadCount === 0)).toBe(false);
  });
});
