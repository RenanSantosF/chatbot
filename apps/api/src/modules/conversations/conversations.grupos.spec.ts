import { ConversationsService } from './conversations.service';

/**
 * O que muda quando a conversa é um GRUPO.
 *
 * Grupo reaproveita toda a estrutura de conversa — histórico, etiquetas,
 * anexo, busca — porque tudo isso faz sentido nele. As três diferenças
 * abaixo são o produto inteiro do recurso, e cada uma existe por um
 * estrago concreto que ela evita.
 */
function montar() {
  const criadas: Record<string, unknown>[] = [];
  const atualizacoes: Record<string, unknown>[] = [];
  const mensagens: Record<string, unknown>[] = [];

  const conversa = {
    id: 'conversa-1',
    tenantId: 'tenant-teste',
    customerId: 'cliente-1',
    status: 'OPEN',
    aiMode: 'HUMAN_ACTIVE',
    customer: { id: 'cliente-1', name: 'Fornecedores', phone: '120363000@g.us' },
    messages: [],
  };

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
          criadas.push(args.data);
          return { ...conversa, ...args.data };
        }),
        update: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
          atualizacoes.push(args.data);
          return conversa;
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      message: {
        create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
          mensagens.push(args.data);
          return { id: 'msg-1', createdAt: new Date(), ...args.data };
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    },
  };

  const aiEngine = {
    podeAtender: jest.fn().mockResolvedValue(true),
    generateReply: jest.fn().mockResolvedValue({ tipo: 'nao_respondeu' }),
  };
  const inboxSettings = {
    get: jest.fn().mockResolvedValue({
      greetingEnabled: true,
      greetingMessage: 'Olá!',
      agruparConversas: false,
    }),
  };
  const customers = {
    findOrCreateByPhone: jest
      .fn()
      .mockResolvedValue({ id: 'cliente-1', phone: '120363000@g.us' }),
  };

  const service = new ConversationsService(
    prisma as never,
    customers as never,
    { emitToTenant: jest.fn() } as never,
    aiEngine as never,
    { enviarTexto: jest.fn(), marcarComoLida: jest.fn() } as never,
    {} as never,
    inboxSettings as never,
    {} as never,
    {} as never,
    {} as never,
    { transcreverSeAutomatico: jest.fn() } as never,
    { registrar: jest.fn() } as never,
    { avisarEquipe: jest.fn().mockResolvedValue(undefined) } as never,
  );

  return { service, criadas, atualizacoes, mensagens, aiEngine, customers };
}

const doGrupo = {
  customerPhone: '120363000@g.us',
  customerName: 'Fornecedores',
  content: 'alguém viu o pedido?',
  grupo: true,
  participante: 'Ana',
} as const;

describe('conversa de grupo', () => {
  it('nasce humana mesmo com a IA ligada e com credencial', async () => {
    /*
     * Um robô respondendo cada mensagem de um grupo de quarenta pessoas é
     * constrangedor pra empresa e é padrão de spam pro WhatsApp — o tipo
     * de comportamento que bloqueia número. Não é configurável de
     * propósito.
     */
    const { service, criadas, aiEngine } = montar();

    await service.receiveInbound({ ...doGrupo });

    expect(aiEngine.podeAtender).not.toHaveBeenCalled();
    expect(criadas[0]).toMatchObject({ aiMode: 'HUMAN_ACTIVE' });
  });

  it('a saudação automática não sai em grupo', async () => {
    // Ela existe pra dizer a um cliente que alguém já vai atender. Num
    // grupo, seria a empresa falando sozinha sempre que qualquer pessoa
    // escrevesse.
    const { service } = montar();

    const { conversation } = await service.receiveInbound({ ...doGrupo });

    const textos = (conversation?.messages ?? []) as { content: string }[];
    expect(textos.some((m) => m.content === 'Olá!')).toBe(false);
  });

  it('não entra na fila nem liga o relógio de espera', async () => {
    /*
     * Esta é a que mais estragaria se faltasse. Um grupo ativo produz
     * dezenas de mensagens por dia, e cada uma marcaria a conversa como
     * "aberta, esperando a empresa": o contador de Pendentes viraria
     * ficção e o alarme de espera passaria a gritar por uma conversa que
     * ninguém precisa responder — enterrando o cliente de verdade.
     */
    const { service, atualizacoes } = montar();

    await service.receiveInbound({ ...doGrupo });

    const naConversa = atualizacoes.find((a) => 'lastMessageAt' in a);
    expect(naConversa).toBeDefined();
    expect(naConversa).not.toHaveProperty('status');
    expect(naConversa).not.toHaveProperty('waitingSince');
    // A hora da última mensagem CONTINUA subindo: é assim que um grupo se
    // acompanha na lista. O que ele não faz é cobrar resposta.
    expect(naConversa).toHaveProperty('lastMessageAt');
  });

  it('o cliente nasce marcado como grupo, com o JID inteiro', async () => {
    // Grupo não tem telefone. Guardar dígitos faria o envio montar
    // `120363000@s.whatsapp.net` — um destino individual que não existe.
    const { service, customers } = montar();

    await service.receiveInbound({ ...doGrupo });

    expect(customers.findOrCreateByPhone).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '120363000@g.us', grupo: true }),
    );
  });

  it('quem falou fica gravado na mensagem', async () => {
    // Sem isso a conversa é ilegível: mensagens seguidas de gente
    // diferente, todas do mesmo lado do balão. Vai no metadado, e não numa
    // coluna: só o balão de grupo lê isso, e criar coluna na tabela que
    // mais cresce do sistema sairia caro em disco e em índice.
    const { service, mensagens } = montar();

    await service.receiveInbound({ ...doGrupo });

    const doCliente = mensagens.find((m) => m.senderType === 'CUSTOMER') as
      | { metadata?: { participante?: string } }
      | undefined;
    expect(doCliente?.metadata?.participante).toBe('Ana');
  });
});

/**
 * A IA não fala em grupo NEM quando o banco diz que ela pode.
 *
 * Relato de cliente: "a IA está respondendo automaticamente conversas de
 * grupo". A regra existia, mas era garantida por um valor GRAVADO uma vez,
 * no nascimento da conversa — e valor gravado não é regra, é histórico.
 * Bastava um caminho criar ou reabrir a conversa sem a bandeira (e havia
 * mais de um) pra `aiMode` ficar AI_ACTIVE, e daí em diante ninguém mais
 * perguntava se aquilo era grupo.
 *
 * Estes testes cobrem o ponto por onde a IA de fato fala. É lá que a
 * pergunta tem que ser feita, porque é o único lugar que decide.
 */
describe('a trava de grupo vale mesmo com a IA ligada na conversa', () => {
  function comConversaLigada() {
    const contexto = montar();
    // A conversa JÁ existe e está com a IA no comando — o estado errado
    // que ficou no banco de quem foi atingido pelo defeito.
    (contexto.service as never as {
      prisma: { db: { conversation: { findFirst: jest.Mock } } };
    }).prisma.db.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenantId: 'tenant-teste',
      customerId: 'cliente-1',
      status: 'OPEN',
      aiMode: 'AI_ACTIVE',
      priority: 'NORMAL',
      customer: { id: 'cliente-1', name: 'Fornecedores', phone: '120363000@g.us' },
      messages: [],
    });
    return contexto;
  }

  it('não chama a IA numa conversa de grupo já marcada como AI_ACTIVE', async () => {
    const { service, aiEngine } = comConversaLigada();

    await service.receiveInbound({ ...doGrupo });

    expect(aiEngine.generateReply).not.toHaveBeenCalled();
  });

  it('e desliga a IA daquela conversa, pra ela não tentar de novo', async () => {
    // Só não responder resolveria esta mensagem. Desligar resolve a
    // conversa: ela sai de "com a IA" no painel e para de mentir sobre
    // quem está no comando.
    const { service, atualizacoes } = comConversaLigada();

    await service.receiveInbound({ ...doGrupo });

    expect(atualizacoes).toContainEqual(
      expect.objectContaining({ aiMode: 'HUMAN_ACTIVE' }),
    );
  });
});
