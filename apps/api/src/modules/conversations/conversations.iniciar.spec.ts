import { BadRequestException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

/**
 * Puxar conversa com quem nunca escreveu.
 *
 * O único caminho que existia exigia um modelo aprovado pela Meta — regra
 * do canal oficial, onde texto livre é recusado fora da janela de 24
 * horas. Numa conta conectada por QR code aquele caminho era uma porta
 * trancada: ele pedia um modelo que a conta nunca teria.
 */
function montar(conversaAberta: Record<string, unknown> | null = null) {
  const criadas: Record<string, unknown>[] = [];
  const conversa = {
    id: 'conversa-1',
    channel: 'WHATSAPP',
    aiMode: 'HUMAN_ACTIVE',
    customer: { id: 'cliente-1', phone: '5527999998888', name: 'Ana' },
    messages: [],
    tags: [],
  };

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        findFirst: jest
          .fn()
          .mockImplementation((args: { select?: unknown; include?: unknown }) => {
            // Com `include` é o detalhe montado no fim (getById); com
            // `select` é uma conferência interna; sem os dois é a busca
            // por conversa já aberta deste cliente.
            if (args?.include) return conversa;
            if (args?.select) return { status: 'OPEN', aiMode: 'HUMAN_ACTIVE' };
            return conversaAberta;
          }),
        create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
          criadas.push(args.data);
          return { ...conversa, ...args.data };
        }),
        update: jest.fn().mockResolvedValue(conversa),
        // O teto diário de primeiras abordagens (ver protegerContraBloqueio).
        count: jest.fn().mockResolvedValue(0),
      },
      message: {
        create: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) => ({
            id: 'msg-1',
            createdAt: new Date(),
            ...args.data,
          })),
        update: jest.fn().mockImplementation((args: { data: unknown }) => ({
          id: 'msg-1',
          ...(args.data as object),
        })),
        findFirst: jest.fn().mockResolvedValue(null),
        // `getById` no fim monta o detalhe completo da conversa.
        findMany: jest.fn().mockResolvedValue([]),
      },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cliente-1' }) },
      user: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    },
  };

  const whatsapp = {
    enviarTexto: jest.fn().mockResolvedValue('wamid.NOVA'),
    marcarComoLida: jest.fn(),
    // `true` é o caminho normal: o número existe. Os testes que exercitam
    // a trava sobrescrevem isto.
    numeroExiste: jest.fn().mockResolvedValue(true),
    motivoDaUltimaFalha: null,
  };

  const customers = {
    findOrCreateByPhone: jest
      .fn()
      .mockResolvedValue({ id: 'cliente-1', phone: '5527999998888' }),
  };

  const service = new ConversationsService(
    prisma as never,
    customers as never,
    { emitToTenant: jest.fn() } as never,
    {
      generateReply: jest.fn(),
      podeAtender: jest.fn().mockResolvedValue(false),
    } as never,
    whatsapp as never,
    {} as never,
    { get: jest.fn().mockResolvedValue({ showAgentName: false }) } as never,
    {} as never,
    {} as never,
    {} as never,
    { transcreverSeAutomatico: jest.fn() } as never,
    { registrar: jest.fn() } as never,
    { avisarEquipe: jest.fn().mockResolvedValue(undefined) } as never,
  );

  return { service, whatsapp, customers, criadas, prisma };
}

describe('iniciar conversa escrevendo', () => {
  it('manda a mensagem de verdade, sem modelo nenhum', async () => {
    const { service, whatsapp } = montar();

    await service.iniciarConversa(
      { phone: '5527999998888', content: 'Oi Ana, tudo bem?' },
      'user-1',
    );

    expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
      '5527999998888',
      'Oi Ana, tudo bem?',
      undefined,
    );
  });

  it('aceita telefone digitado com máscara', async () => {
    // Exigir formato aqui transformaria um acerto trivial num erro na
    // cara de quem só colou o número do jeito que estava anotado.
    const { service, customers } = montar();

    await service.iniciarConversa(
      { phone: '+55 (27) 99999-8888', content: 'oi' },
      'user-1',
    );

    expect(customers.findOrCreateByPhone).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '5527999998888' }),
    );
  });

  it('nasce humana e com dono — quem puxou a conversa é quem fala', async () => {
    // Deixar a IA responder por cima de uma abordagem que uma pessoa
    // começou é o oposto do que se quer aqui.
    const { service, criadas } = montar();

    await service.iniciarConversa(
      { phone: '5527999998888', content: 'oi' },
      'user-1',
    );

    expect(criadas[0]).toMatchObject({
      aiMode: 'HUMAN_ACTIVE',
      assignedUserId: 'user-1',
    });
  });

  it('reaproveita a conversa aberta em vez de partir o histórico em duas', async () => {
    const { service, criadas } = montar({ id: 'conversa-1', status: 'OPEN' });

    await service.iniciarConversa(
      { phone: '5527999998888', content: 'oi de novo' },
      'user-1',
    );

    expect(criadas).toHaveLength(0);
  });

  it('recusa telefone curto demais pra ser um número com DDI', async () => {
    const { service, whatsapp } = montar();

    await expect(
      service.iniciarConversa({ phone: '99998888', content: 'oi' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('recusa mensagem vazia antes de criar qualquer coisa', async () => {
    const { service, customers } = montar();

    await expect(
      service.iniciarConversa({ phone: '5527999998888', content: '   ' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(customers.findOrCreateByPhone).not.toHaveBeenCalled();
  });
});

/**
 * As travas que separam "puxar conversa" de "disparar em massa".
 *
 * O canal por QR code é cliente NÃO OFICIAL do WhatsApp, e a conta pode
 * ser bloqueada por padrão de comportamento. Falar primeiro com quem nunca
 * escreveu é justamente o comportamento que mais se parece com spam — daí
 * as duas conferências antes de deixar sair.
 */
describe('proteção contra bloqueio do número', () => {
  it('número que não existe no WhatsApp não recebe nada', async () => {
    // Disparar pra número inexistente é o que quem varre faixas de número
    // faz. Um dígito digitado errado produz exatamente esse sinal.
    const { service, whatsapp, customers } = montar();
    whatsapp.numeroExiste.mockResolvedValue(false);

    await expect(
      service.iniciarConversa({ phone: '5527999998888', content: 'oi' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
    expect(customers.findOrCreateByPhone).not.toHaveBeenCalled();
  });

  it('conferência indisponível NÃO barra o envio', async () => {
    // `null` é "não deu pra conferir", e é diferente de "não existe":
    // transformar uma indisponibilidade nossa em "esse cliente não existe"
    // travaria o atendimento por um problema que não é dele.
    const { service, whatsapp } = montar();
    whatsapp.numeroExiste.mockResolvedValue(null);

    await service.iniciarConversa(
      { phone: '5527999998888', content: 'oi' },
      'user-1',
    );

    expect(whatsapp.enviarTexto).toHaveBeenCalled();
  });

  it('o teto diário de primeiras abordagens barra a próxima', async () => {
    const { service, prisma, whatsapp } = montar();
    (prisma.db.conversation.count as jest.Mock).mockResolvedValue(30);

    await expect(
      service.iniciarConversa({ phone: '5527999998888', content: 'oi' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('o teto conta só quem nunca respondeu, e só de hoje', async () => {
    // Responder quem escreveu não tem teto: não é isso que derruba conta.
    // Se o recorte pegasse atendimento em geral, uma empresa movimentada
    // ficaria impedida de puxar conversa por causa do próprio volume.
    const { service, prisma } = montar();

    await service.iniciarConversa(
      { phone: '5527999998888', content: 'oi' },
      'user-1',
    );

    const { where } = (prisma.db.conversation.count as jest.Mock).mock
      .calls[0][0] as {
      where: {
        status: string;
        createdAt: { gte: Date };
        messages: { none: { senderType: string } };
      };
    };
    expect(where.status).toBe('WAITING_CUSTOMER');
    expect(where.messages.none.senderType).toBe('CUSTOMER');
    expect(where.createdAt.gte.getHours()).toBe(0);
  });
});
