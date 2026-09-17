import { ConversationsService } from './conversations.service';

/**
 * Apagar tem que valer em TODA cópia do texto que sai da API.
 *
 * O balão já era sanitizado na saída (`esconderApagada`), mas o mesmo
 * conteúdo continuava saindo por duas outras portas, e as duas são
 * visíveis sem abrir nada:
 *
 * - a PRÉVIA da lista, que é a linha que fica à mostra o dia todo, de
 *   longe, numa tela que a equipe compartilha;
 * - a CITAÇÃO, quando alguém respondeu àquela mensagem: a tarjinha
 *   guardava o texto original mesmo depois de a mensagem citada sumir.
 *
 * Apagar e ver a frase continuar na tela é pior que não ter o botão: quem
 * clicou acredita que resolveu.
 */
function montar(dados: {
  ultimaMensagem?: Record<string, unknown> | null;
  mensagens?: Record<string, unknown>[];
}) {
  const conversa = {
    id: 'conversa-1',
    channel: 'WHATSAPP',
    customer: { id: 'cliente-1', phone: '5527999998888', name: 'Ana' },
    tags: [],
    messages: dados.ultimaMensagem ? [dados.ultimaMensagem] : [],
  };

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        findMany: jest.fn().mockResolvedValue([conversa]),
        findFirst: jest.fn().mockResolvedValue(conversa),
      },
      message: {
        findMany: jest.fn().mockResolvedValue(dados.mensagens ?? []),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
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
    {} as never,
    { registrar: jest.fn() } as never,
    { avisarEquipe: jest.fn().mockResolvedValue(undefined) } as never,
  );

  return { service, prisma };
}

describe('prévia da lista', () => {
  it('não mostra o texto da última mensagem depois de ela ser apagada', async () => {
    const { service } = montar({
      ultimaMensagem: {
        content: 'o valor combinado era R$ 4.000',
        senderType: 'AGENT',
        messageType: 'TEXT',
        deletedAt: new Date(),
      },
    });

    const pagina = await service.list({});

    expect(pagina.items[0].lastMessage?.content).toBe('');
  });

  it('a prévia normal continua inteira', async () => {
    const { service } = montar({
      ultimaMensagem: {
        content: 'bom dia, tudo certo?',
        senderType: 'CUSTOMER',
        messageType: 'TEXT',
        deletedAt: null,
      },
    });

    const pagina = await service.list({});

    expect(pagina.items[0].lastMessage?.content).toBe('bom dia, tudo certo?');
  });

  it('conversa sem mensagem nenhuma não vira prévia inventada', async () => {
    const { service } = montar({ ultimaMensagem: null });

    const pagina = await service.list({});

    expect(pagina.items[0].lastMessage).toBeNull();
  });
});

describe('citação de mensagem apagada', () => {
  const citacaoApagada = {
    id: 'msg-2',
    conversationId: 'conversa-1',
    senderType: 'CUSTOMER',
    senderId: null,
    content: 'pode confirmar?',
    messageType: 'TEXT',
    metadata: null,
    deletedAt: null,
    replyToId: 'msg-1',
    replyTo: {
      id: 'msg-1',
      content: 'o valor combinado era R$ 4.000',
      senderType: 'AGENT',
      messageType: 'TEXT',
      deletedAt: new Date(),
    },
    createdAt: new Date(),
  };

  it('a tarjinha não carrega mais o texto do que foi apagado', async () => {
    const { service } = montar({ mensagens: [citacaoApagada] });

    const pagina = await service.listMessages('conversa-1');

    expect(pagina.items[0].replyTo?.content).toBe('');
  });

  it('a mensagem que cita continua visível — quem foi apagado é a citada', async () => {
    const { service } = montar({ mensagens: [citacaoApagada] });

    const pagina = await service.listMessages('conversa-1');

    expect(pagina.items[0].content).toBe('pode confirmar?');
  });

  it('citação de mensagem viva continua mostrando o texto', async () => {
    const { service } = montar({
      mensagens: [
        {
          ...citacaoApagada,
          replyTo: { ...citacaoApagada.replyTo, deletedAt: null },
        },
      ],
    });

    const pagina = await service.listMessages('conversa-1');

    expect(pagina.items[0].replyTo?.content).toBe(
      'o valor combinado era R$ 4.000',
    );
  });
});
