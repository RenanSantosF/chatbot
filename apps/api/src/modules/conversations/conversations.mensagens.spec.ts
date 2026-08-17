import { ConversationsService } from './conversations.service';

/**
 * O caminho por onde TODA mensagem passa.
 *
 * `persistMessage` grava, decide de quem é a vez, mexe no contador de não
 * lidas e — quando é resposta da empresa — manda pro WhatsApp. Errar
 * qualquer um desses quatro produz um defeito visível pro cliente: conversa
 * some da tela de quem atende, tique azul indevido, ou mensagem duplicada
 * no telefone dele.
 */

interface Estado {
  conversaAntes?: {
    status: string;
    aiMode: string;
    waitingSince?: Date | null;
  } | null;
  conversa?: Record<string, unknown>;
  clienteJaExiste?: Record<string, unknown> | null;
  conversaAberta?: Record<string, unknown> | null;
  mensagemJaGravada?: Record<string, unknown> | null;
  /**
   * O que `assumirAoResponder` encontra antes de a resposta ser gravada.
   *
   * O padrão é uma conversa que JÁ tem dono e já está em mãos humanas, e
   * isso é de propósito: assim ele não faz nada e cada teste daqui mede só
   * o efeito da mensagem. A tomada automática do atendimento tem teste
   * próprio (ver conversations.atribuicao.spec.ts).
   */
  /** Motivo da falha de envio. Ausente = a Meta aceitou. */
  falhaNoEnvio?: string;
  antesDeAssumir?: {
    assignedUserId: string | null;
    assignmentAccepted?: boolean;
    aiMode: string;
  };
}

function montar(estado: Estado = {}) {
  const conversa = {
    id: 'conversa-1',
    channel: 'WHATSAPP',
    customer: { id: 'cliente-1', phone: '5527999998888', name: 'Ana' },
    messages: [],
    priority: 'NORMAL',
    ...estado.conversa,
  };

  const criadas: Record<string, unknown>[] = [];
  const atualizacoes: Record<string, unknown>[] = [];
  const atualizacoesDeMensagem: Record<string, unknown>[] = [];

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      conversation: {
        findFirst: jest
          .fn()
          .mockImplementation((args: { select?: Record<string, unknown> }) => {
            // persistMessage lê status/aiMode antes de gravar; os demais
            // caminhos querem a conversa inteira.
            if (
              args?.select &&
              'status' in args.select &&
              'aiMode' in args.select
            ) {
              return (
                estado.conversaAntes ?? {
                  status: 'OPEN',
                  aiMode: 'AI_ACTIVE',
                }
              );
            }
            if (
              args?.select &&
              'assignedUserId' in args.select &&
              'aiMode' in args.select
            ) {
              return (
                estado.antesDeAssumir ?? {
                  assignedUserId: 'user-1',
                  // Aceito: uma linha de verdade sempre traz o booleano, e
                  // sem ele o dono padrão seria lido como indicação
                  // pendente — que agora é motivo pra tomar a conversa.
                  assignmentAccepted: true,
                  aiMode: 'HUMAN_ACTIVE',
                }
              );
            }
            return estado.conversaAberta !== undefined
              ? estado.conversaAberta
              : conversa;
          }),
        update: jest.fn().mockImplementation((args: { data: unknown }) => {
          atualizacoes.push(args.data as Record<string, unknown>);
          return { ...conversa, ...(args.data as object) };
        }),
      },
      message: {
        create: jest.fn().mockImplementation((args: { data: unknown }) => {
          const criada = {
            id: `msg-${criadas.length + 1}`,
            createdAt: new Date('2026-08-14T12:00:00Z'),
            ...(args.data as object),
          };
          criadas.push(criada);
          return criada;
        }),
        update: jest
          .fn()
          .mockImplementation(
            (args: { where: { id: string }; data: Record<string, unknown> }) => {
              atualizacoesDeMensagem.push(args.data);
              // Devolve a linha ATUALIZADA, como o Prisma faz. Importa
              // porque o serviço passou a devolver o resultado do update
              // a quem chamou: com um objeto fixo aqui, o teste não veria
              // a diferença entre a versão de antes e a de depois — que é
              // justamente o defeito que ele guarda.
              const antes =
                criadas.find((m) => m.id === args.where.id) ?? criadas[0] ?? {};
              return { ...antes, ...args.data };
            },
          ),
        findFirst: jest
          .fn()
          .mockResolvedValue(
            estado.mensagemJaGravada !== undefined
              ? estado.mensagemJaGravada
              : null,
          ),
      },
      customer: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            estado.clienteJaExiste !== undefined
              ? estado.clienteJaExiste
              : { id: 'cliente-1' },
          ),
      },
      user: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    },
  };

  const whatsapp = {
    // `undefined` = envio deu certo; qualquer texto = falhou com aquele
    // motivo, do jeito que o serviço de verdade se comporta.
    enviarTexto: jest
      .fn()
      .mockResolvedValue(estado.falhaNoEnvio ? null : 'wamid.NOVO'),
    marcarComoLida: jest.fn(),
    motivoDaUltimaFalha: estado.falhaNoEnvio ?? null,
  };
  const realtime = { emitToTenant: jest.fn() };
  const inboxSettings = {
    get: jest.fn().mockResolvedValue({ showAgentName: false }),
  };

  const service = new ConversationsService(
    prisma as never,
    {} as never,
    realtime as never,
    {} as never,
    whatsapp as never,
    {} as never,
    inboxSettings as never,
    {} as never,
    {} as never,
    {} as never,
    { transcreverSeAutomatico: jest.fn() } as never,
  );

  return {
    service,
    prisma,
    whatsapp,
    realtime,
    criadas,
    atualizacoes,
    atualizacoesDeMensagem,
  };
}

describe('eco do celular (coexistência)', () => {
  /**
   * O caso: o mesmo número está no aplicativo WhatsApp Business e na Cloud
   * API. O que a empresa digita no celular volta pra cá pelo webhook como
   * mensagem de atendente, só pra o histórico do painel não mentir.
   *
   * Ela JÁ chegou no cliente. Reenviar daqui faria ele receber tudo duas
   * vezes — e o pior: o externalId gravado passaria a ser o do reenvio, não
   * o do eco, então a próxima reentrega do webhook (a Meta reenvia quando
   * não recebe 2xx a tempo) não reconheceria a mensagem e duplicaria de
   * novo, sem fim.
   */
  it('não reenvia pro cliente o que já saiu pelo celular', async () => {
    const { service, whatsapp } = montar();

    await service.recordOutboundEcho({
      customerPhone: '5527999998888',
      content: 'Bom dia, já estou vendo aqui.',
      externalId: 'wamid.DO_CELULAR',
    });

    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('preserva o externalId do eco, que é o que segura a idempotência', async () => {
    const { service, criadas, prisma } = montar();

    await service.recordOutboundEcho({
      customerPhone: '5527999998888',
      content: 'Bom dia',
      externalId: 'wamid.DO_CELULAR',
    });

    expect(criadas[0].externalId).toBe('wamid.DO_CELULAR');
    // Nenhuma sobrescrita depois: o update de externalId só existe pro
    // caminho de envio nosso.
    expect(prisma.db.message.update).not.toHaveBeenCalled();
  });

  it('grava como já enviada, não como pendente', async () => {
    // Quem entregou foi o WhatsApp do celular; não há entrega nossa a
    // confirmar, então o balão não pode ficar com o relógio de "enviando".
    const { service, criadas } = montar();

    await service.recordOutboundEcho({
      customerPhone: '5527999998888',
      content: 'Bom dia',
    });

    expect(criadas[0].status).toBe('SENT');
  });

  it('ignora o eco repetido que a Meta reenvia', async () => {
    const { service, criadas } = montar({
      mensagemJaGravada: { id: 'msg-antiga' },
    });

    const resultado = await service.recordOutboundEcho({
      customerPhone: '5527999998888',
      content: 'Bom dia',
      externalId: 'wamid.REPETIDO',
    });

    expect(resultado).toBeNull();
    expect(criadas).toHaveLength(0);
  });

  it('não inventa conversa a partir de um eco', async () => {
    // Responder pelo celular pressupõe que o cliente escreveu antes. Criar
    // conversa a partir de eco encheria o painel de conversas sem pergunta.
    const { service } = montar({ conversaAberta: null });

    await expect(
      service.recordOutboundEcho({
        customerPhone: '5527999998888',
        content: 'Bom dia',
      }),
    ).resolves.toBeNull();
  });

  it('desliga a IA: uma pessoa acabou de responder', async () => {
    const { service, atualizacoes } = montar({
      conversaAberta: { id: 'conversa-1', aiMode: 'AI_ACTIVE' },
    });

    await service.recordOutboundEcho({
      customerPhone: '5527999998888',
      content: 'Bom dia',
    });

    expect(atualizacoes).toContainEqual(
      expect.objectContaining({ aiMode: 'HUMAN_ACTIVE' }),
    );
  });
});

describe('resposta do atendente pelo painel', () => {
  it('sai pro WhatsApp — este é o caminho que de fato envia', async () => {
    const { service, whatsapp } = montar();

    await service.sendAgentMessage(
      'conversa-1',
      'user-1',
      'Claro, já verifico.',
    );

    expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
      '5527999998888',
      'Claro, já verifico.',
      undefined,
    );
  });

  it('guarda o wamid devolvido pela Meta, pra o tique de entrega achar a mensagem', async () => {
    const { service, prisma } = montar();

    await service.sendAgentMessage('conversa-1', 'user-1', 'Oi');

    expect(prisma.db.message.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { externalId: 'wamid.NOVO' } }),
    );
  });

  it('zera as não lidas: quem responde leu', async () => {
    const { service, atualizacoes } = montar();

    await service.sendAgentMessage('conversa-1', 'user-1', 'Oi');

    expect(atualizacoes[0]).toMatchObject({
      status: 'WAITING_CUSTOMER',
      unreadCount: 0,
    });
  });
});

describe('de quem é a vez depois de cada mensagem', () => {
  it('mensagem do cliente abre a conversa e soma uma não lida', async () => {
    const { service, atualizacoes } = montar();

    await service['persistMessage']('conversa-1', {
      senderType: 'CUSTOMER',
      content: 'Oi',
    });

    expect(atualizacoes[0]).toMatchObject({
      status: 'OPEN',
      unreadCount: { increment: 1 },
    });
  });

  it('nota interna do sistema não muda de quem é a vez nem conta como não lida', async () => {
    // Antes ela empurrava a conversa pra "aguardando cliente" logo depois
    // de cair no colo de um atendente.
    const { service, atualizacoes } = montar();

    await service['persistMessage']('conversa-1', {
      senderType: 'SYSTEM',
      content: 'Conversa encaminhada para o setor Financeiro.',
    });

    expect(atualizacoes[0]).not.toHaveProperty('status');
    expect(atualizacoes[0]).not.toHaveProperty('unreadCount');
  });

  it('a despedida da IA não desfaz a transferência que ela acabou de fazer', async () => {
    // "Já te encaminhei, um momento" vinha depois do handoff e devolvia a
    // conversa pra "aguardando cliente" — ninguém a via como pendente.
    const { service, atualizacoes } = montar({
      conversaAntes: { status: 'WAITING_AGENT', aiMode: 'HUMAN_ACTIVE' },
    });

    await service['persistMessage']('conversa-1', {
      senderType: 'AI',
      content: 'Já te encaminhei para a equipe, um momento.',
    });

    expect(atualizacoes[0]).not.toHaveProperty('status');
  });

  it('resposta normal da IA continua passando a vez pro cliente', async () => {
    const { service, atualizacoes } = montar({
      conversaAntes: { status: 'OPEN', aiMode: 'AI_ACTIVE' },
    });

    await service['persistMessage']('conversa-1', {
      senderType: 'AI',
      content: 'Nosso horário é das 9h às 18h.',
    });

    expect(atualizacoes[0]).toMatchObject({ status: 'WAITING_CUSTOMER' });
  });

  it('nota do sistema não vaza pro WhatsApp do cliente', async () => {
    const { service, whatsapp } = montar();

    await service['persistMessage']('conversa-1', {
      senderType: 'SYSTEM',
      content: 'Indicação recusada. A conversa voltou pra fila.',
    });

    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('conversa que não é de WhatsApp não tenta enviar nada', async () => {
    const { service, whatsapp } = montar({
      conversa: { channel: 'INTERNAL' },
    });

    await service['persistMessage']('conversa-1', {
      senderType: 'AGENT',
      content: 'Oi',
    });

    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });
});

describe('assinatura do atendente', () => {
  it('vai só pro que sai daqui, nunca pro que fica guardado', async () => {
    // Guardar a assinatura junto do conteúdo faria a busca dentro da
    // conversa casar com nome de atendente e sujaria o histórico.
    const { service, whatsapp, criadas, prisma } = montar();
    prisma.db.user.findFirst.mockResolvedValue({
      name: 'Renan Santos Ferreira',
    });
    (
      service as unknown as { inboxSettings: { get: jest.Mock } }
    ).inboxSettings.get.mockResolvedValue({ showAgentName: true });

    await service.sendAgentMessage('conversa-1', 'user-1', 'Já resolvido.');

    expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
      '5527999998888',
      '*Renan:*\nJá resolvido.',
      undefined,
    );
    expect(criadas[0].content).toBe('Já resolvido.');
  });

  it('a IA não assina — ela já se apresenta pelo nome configurado', async () => {
    const { service, whatsapp, prisma } = montar();
    prisma.db.user.findFirst.mockResolvedValue({ name: 'Renan' });
    (
      service as unknown as { inboxSettings: { get: jest.Mock } }
    ).inboxSettings.get.mockResolvedValue({ showAgentName: true });

    await service['persistMessage']('conversa-1', {
      senderType: 'AI',
      content: 'Posso ajudar em mais alguma coisa?',
    });

    expect(whatsapp.enviarTexto).toHaveBeenCalledWith(
      '5527999998888',
      'Posso ajudar em mais alguma coisa?',
      undefined,
    );
  });
});

describe('relógio da espera (fila de atendimento)', () => {
  it('mensagem do cliente começa a contar a espera', async () => {
    const { service, atualizacoes } = montar({
      conversaAntes: {
        status: 'OPEN',
        aiMode: 'AI_ACTIVE',
        waitingSince: null,
      },
    });

    await service['persistMessage']('conversa-1', {
      senderType: 'CUSTOMER',
      content: 'Oi, preciso de ajuda',
    });

    expect(atualizacoes[0].waitingSince).toBeInstanceOf(Date);
  });

  it('cobrar não reinicia o relógio — a espera é desde a PRIMEIRA', async () => {
    // Quem escreveu às 9h e cobrou às 11h espera desde as 9h. Reiniciar
    // premiaria quem insiste, que é exatamente o defeito da ordem por
    // recência que a fila existe pra corrigir.
    const desdeCedo = new Date('2026-08-14T09:00:00Z');
    const { service, atualizacoes } = montar({
      conversaAntes: {
        status: 'OPEN',
        aiMode: 'AI_ACTIVE',
        waitingSince: desdeCedo,
      },
    });

    await service['persistMessage']('conversa-1', {
      senderType: 'CUSTOMER',
      content: 'alguém aí?',
    });

    expect(atualizacoes[0]).not.toHaveProperty('waitingSince');
  });

  it('resposta do atendente para o relógio', async () => {
    const { service, atualizacoes } = montar({
      conversaAntes: {
        status: 'OPEN',
        aiMode: 'HUMAN_ACTIVE',
        waitingSince: new Date('2026-08-14T09:00:00Z'),
      },
    });

    await service.sendAgentMessage('conversa-1', 'user-1', 'Já verifico!');

    expect(atualizacoes[0].waitingSince).toBeNull();
  });

  it('resposta da IA também para o relógio', async () => {
    // Atendida pela IA é atendida: deixar o relógio correndo encheria a
    // fila de conversas que já foram respondidas.
    const { service, atualizacoes } = montar({
      conversaAntes: {
        status: 'OPEN',
        aiMode: 'AI_ACTIVE',
        waitingSince: new Date('2026-08-14T09:00:00Z'),
      },
    });

    await service['persistMessage']('conversa-1', {
      senderType: 'AI',
      content: 'Nosso horário é das 9h às 18h.',
    });

    expect(atualizacoes[0].waitingSince).toBeNull();
  });

  it('nota do sistema NÃO para o relógio', async () => {
    // Transferir de setor não é responder ao cliente. Se zerasse aqui, a
    // conversa sairia da fila no momento em que mais precisa estar nela.
    const { service, atualizacoes } = montar({
      conversaAntes: {
        status: 'WAITING_AGENT',
        aiMode: 'HUMAN_ACTIVE',
        waitingSince: new Date('2026-08-14T09:00:00Z'),
      },
    });

    await service['persistMessage']('conversa-1', {
      senderType: 'SYSTEM',
      content: 'Conversa encaminhada para o setor Financeiro.',
    });

    expect(atualizacoes[0]).not.toHaveProperty('waitingSince');
  });

  it('anexo do atendente para o relógio', async () => {
    // Este caminho não passa por persistMessage (sobe arquivo antes), e
    // esquecer aqui deixaria a conversa presa no topo da fila depois de
    // uma foto respondida.
    const { service, atualizacoes } = montar();

    // O canal recebe o ARQUIVO e devolve o id da mensagem mais o handle
    // por onde buscar o binário depois — quem faz upload, se fizer, é o
    // provedor por dentro (ver canal.interface).
    const whatsapp = {
      enviarMidia: jest
        .fn()
        .mockResolvedValue({ externalId: 'wamid.MIDIA', handle: 'media-1' }),
      motivoDaUltimaFalha: null,
    };
    Object.assign(service as unknown as Record<string, unknown>, { whatsapp });

    await service.sendAttachment('conversa-1', 'user-1', {
      buffer: Buffer.from('imagem'),
      mimetype: 'image/png',
      originalname: 'foto.png',
      size: 6,
    });

    expect(atualizacoes[0].waitingSince).toBeNull();
  });
});

describe('entrega repetida do webhook', () => {
  /**
   * A Meta reenvia quando não recebe 2xx a tempo — e "a tempo" inclui o
   * tempo que a IA leva pra responder, porque a resposta acontece dentro
   * desta mesma chamada. Sem conferir, a reentrega gravava a pergunta do
   * cliente duas vezes e fazia a IA responder duas vezes à mesma coisa.
   */
  it('a mesma mensagem não entra duas vezes', async () => {
    const { service, criadas } = montar({
      mensagemJaGravada: { id: 'msg-antiga', conversationId: 'conversa-1' },
    });

    const resultado = await service.receiveInbound({
      customerPhone: '5527999998888',
      customerName: 'Ana',
      content: 'Oi',
      externalId: 'wamid.REPETIDO',
    });

    expect(criadas).toHaveLength(0);
    expect(resultado.message).toBeNull();
  });

  it('a IA não responde de novo à entrega repetida', async () => {
    const respondeu = jest.fn();
    const { service } = montar({
      mensagemJaGravada: { id: 'msg-antiga', conversationId: 'conversa-1' },
    });
    Object.assign(service as unknown as Record<string, unknown>, {
      aiEngine: { generateReply: respondeu },
    });

    await service.receiveInbound({
      customerPhone: '5527999998888',
      customerName: 'Ana',
      content: 'Oi',
      externalId: 'wamid.REPETIDO',
    });

    expect(respondeu).not.toHaveBeenCalled();
  });

  it('mensagem sem id externo (simulador) segue o caminho normal', async () => {
    // O simulador de cliente não tem wamid; barrar por ausência de id
    // quebraria o teste que o dono usa pra experimentar a IA.
    const { service, criadas } = montar({
      mensagemJaGravada: null,
      conversa: { channel: 'INTERNAL' },
    });
    Object.assign(service as unknown as Record<string, unknown>, {
      customers: {
        findOrCreateByPhone: jest.fn().mockResolvedValue({ id: 'cliente-1' }),
      },
      aiEngine: {
        generateReply: jest.fn().mockResolvedValue({ tipo: 'semPergunta' }),
      },
    });

    await service.receiveInbound({
      customerPhone: '5527999998888',
      customerName: 'Ana',
      content: 'Oi',
    });

    expect(criadas).toHaveLength(1);
  });
});

/**
 * Mensagem que não saiu não pode parecer entregue.
 *
 * O relato que originou isto: o WhatsApp foi desconectado, o atendente
 * mandou uma mensagem, e o balão apareceu com o mesmo tique de sempre. Do
 * lado de cá parecia tudo certo; do lado do cliente não chegou nada. O
 * único lugar que sabia da verdade era o log do servidor — que quem atende
 * não abre, e nem deveria precisar.
 *
 * O caminho de ANEXO já marcava a falha desde sempre. O de texto ficava
 * calado, e é justamente por ele que passa a maior parte das mensagens.
 */
describe('envio que falha', () => {
  it('a mensagem fica marcada como FALHOU', async () => {
    const { service, atualizacoesDeMensagem } = montar({
      falhaNoEnvio: 'o WhatsApp não está conectado nesta empresa',
    });

    await service.sendAgentMessage('conversa-1', 'user-1', 'Bom dia!');

    expect(atualizacoesDeMensagem[0]).toMatchObject({ status: 'FAILED' });
  });

  it('o motivo fica junto da mensagem, não só no log', async () => {
    // É o que transforma o triângulo vermelho em algo acionável: quem
    // atende lê "o WhatsApp não está conectado" e sabe o que fazer.
    const { service, atualizacoesDeMensagem } = montar({
      falhaNoEnvio: 'o WhatsApp não está conectado nesta empresa',
    });

    await service.sendAgentMessage('conversa-1', 'user-1', 'Bom dia!');

    expect(atualizacoesDeMensagem[0].metadata).toMatchObject({
      falha: 'o WhatsApp não está conectado nesta empresa',
    });
  });

  it('a tela é avisada na hora', async () => {
    // Sem o aviso, o triângulo só apareceria na próxima vez que alguém
    // abrisse a conversa — e até lá a impressão é de mensagem entregue.
    const { service, realtime } = montar({ falhaNoEnvio: 'a Meta recusou' });

    await service.sendAgentMessage('conversa-1', 'user-1', 'Bom dia!');

    const eventos = realtime.emitToTenant.mock.calls.map(
      (chamada: unknown[]) => chamada[1],
    );
    expect(eventos.filter((e: unknown) => e === 'message.created')).toHaveLength(2);
  });

  it('quando o envio dá certo, grava o id da Meta e não marca falha', async () => {
    const { service, atualizacoesDeMensagem } = montar();

    await service.sendAgentMessage('conversa-1', 'user-1', 'Bom dia!');

    expect(atualizacoesDeMensagem[0]).toMatchObject({ externalId: 'wamid.NOVO' });
    expect(atualizacoesDeMensagem[0]).not.toHaveProperty('status');
  });
});

describe('a IA não conseguiu responder', () => {
  /**
   * Escalar resolve o lado de dentro — a conversa aparece na fila e alguém
   * pega. Do lado de fora continuava um silêncio idêntico ao de um sistema
   * quebrado: a pessoa escreveu e nada voltou.
   */
  function montarComIaFora(status: string) {
    const { service, criadas, atualizacoes } = montar({
      conversa: { status },
      conversaAntes: { status, aiMode: 'AI_ACTIVE' },
      conversaAberta: {
        id: 'conversa-1',
        channel: 'WHATSAPP',
        status,
        aiMode: 'AI_ACTIVE',
        priority: 'NORMAL',
        customer: { id: 'cliente-1', phone: '5527999998888', name: 'Ana' },
        messages: [],
      },
    });

    Object.assign(service as unknown as Record<string, unknown>, {
      aiEngine: {
        generateReply: jest.fn().mockResolvedValue({
          tipo: 'indisponivel',
          motivo:
            'O atendimento automático atingiu o limite de uso e o cliente está esperando.',
        }),
      },
      customers: {
        findOrCreateByPhone: jest
          .fn()
          .mockResolvedValue({ id: 'cliente-1', phone: '5527999998888' }),
      },
      routing: {
        resolveTarget: jest.fn().mockResolvedValue(null),
        resolveByPriority: jest.fn().mockResolvedValue(null),
      },
      collection: { missingRequired: jest.fn().mockResolvedValue([]) },
    });

    return { service, criadas, atualizacoes };
  }

  it('o cliente é avisado de que alguém da equipe vem', async () => {
    const { service, criadas } = montarComIaFora('OPEN');

    await service.receiveInbound({
      customerPhone: '5527999998888',
      customerName: 'Ana',
      content: 'oi, tudo bem?',
      channel: 'WHATSAPP',
    });

    const paraOCliente = criadas.filter((m) => m.senderType === 'AI');
    expect(paraOCliente).toHaveLength(1);
    expect(String(paraOCliente[0].content)).toContain('equipe');
  });

  it('o aviso não menciona o defeito — pro cliente, a empresa só demorou', async () => {
    const { service, criadas } = montarComIaFora('OPEN');

    await service.receiveInbound({
      customerPhone: '5527999998888',
      customerName: 'Ana',
      content: 'oi',
      channel: 'WHATSAPP',
    });

    const texto = String(criadas.find((m) => m.senderType === 'AI')?.content);
    expect(texto).not.toMatch(/erro|falha|limite|sistema|IA/i);
  });

  it('não repete o aviso a cada mensagem de quem insiste', async () => {
    // Três mensagens seguidas com a IA fora rendiam três avisos iguais —
    // pior que nenhum. A conversa já aguardando atendente significa que o
    // aviso já foi dado.
    const { service, criadas } = montarComIaFora('WAITING_AGENT');

    await service.receiveInbound({
      customerPhone: '5527999998888',
      customerName: 'Ana',
      content: 'alguém aí?',
      channel: 'WHATSAPP',
    });

    expect(criadas.filter((m) => m.senderType === 'AI')).toHaveLength(0);
  });
});

describe('cliente que escreve em rajada', () => {
  /**
   * Dois casos, o mesmo remédio.
   *
   * O cotidiano: a pessoa digita "oi", "tudo bem?", "queria saber o
   * horário" em três mensagens seguidas e recebe três respostas — a
   * primeira cumprimentando quem já tinha perguntado.
   *
   * O do reencontro: a sessão da Evolution fica fora do ar, o cliente
   * manda cinco mensagens, e ao voltar o WhatsApp entrega tudo de uma vez.
   * Sem isto, saíam cinco respostas para perguntas de horas atrás.
   */
  function montarComRajada(temMensagemMaisNova: boolean) {
    const { service, criadas } = montar({
      conversaAntes: { status: 'OPEN', aiMode: 'AI_ACTIVE' },
      conversaAberta: {
        id: 'conversa-1',
        channel: 'WHATSAPP',
        status: 'OPEN',
        aiMode: 'AI_ACTIVE',
        priority: 'NORMAL',
        customer: { id: 'cliente-1', phone: '5527999998888', name: 'Ana' },
        messages: [],
      },
    });

    const gerou = jest.fn().mockResolvedValue({
      tipo: 'respondeu',
      resposta: {
        content: 'Olá! Como posso ajudar?',
        verificacao: { precisaHandoff: false },
      },
    });

    Object.assign(service as unknown as Record<string, unknown>, {
      aiEngine: { generateReply: gerou },
      customers: {
        findOrCreateByPhone: jest
          .fn()
          .mockResolvedValue({ id: 'cliente-1', phone: '5527999998888' }),
      },
      chegouOutraDepois: jest.fn().mockResolvedValue(temMensagemMaisNova),
    });

    return { service, criadas, gerou };
  }

  it('não responde a mensagem que já tem outra atrás dela', async () => {
    const { service, criadas, gerou } = montarComRajada(true);

    await service.receiveInbound({
      customerPhone: '5527999998888',
      customerName: 'Ana',
      content: 'oi',
      channel: 'WHATSAPP',
    });

    // Nem chega a gastar a chamada ao modelo: a pergunta ainda não
    // terminou de ser feita.
    expect(gerou).not.toHaveBeenCalled();
    expect(criadas.filter((m) => m.senderType === 'AI')).toHaveLength(0);
  });

  it('responde normalmente quando a mensagem é a última', async () => {
    const { service, criadas, gerou } = montarComRajada(false);

    await service.receiveInbound({
      customerPhone: '5527999998888',
      customerName: 'Ana',
      content: 'queria saber o horário',
      channel: 'WHATSAPP',
    });

    expect(gerou).toHaveBeenCalled();
    expect(criadas.filter((m) => m.senderType === 'AI')).toHaveLength(1);
  });

  it('descarta a resposta se o cliente escreveu enquanto a IA pensava', async () => {
    // Gerar leva segundos, e é justamente nesse intervalo que quem está
    // digitando manda a próxima. A resposta pronta já nasceu velha: ela
    // viu metade da pergunta.
    const { service, criadas } = montarComRajada(false);

    let chamadas = 0;
    Object.assign(service as unknown as Record<string, unknown>, {
      chegouOutraDepois: jest.fn().mockImplementation(() => {
        chamadas += 1;
        // Nada antes de gerar; alguém chegou durante.
        return Promise.resolve(chamadas > 1);
      }),
    });

    await service.receiveInbound({
      customerPhone: '5527999998888',
      customerName: 'Ana',
      content: 'oi',
      channel: 'WHATSAPP',
    });

    expect(criadas.filter((m) => m.senderType === 'AI')).toHaveLength(0);
  });
});

describe('o que o painel recebe quando o envio falha', () => {
  /**
   * O relato: com o WhatsApp desconectado, o balão nascia com o tique de
   * enviado e só contava a verdade depois de recarregar a página.
   *
   * A causa era o retorno: a API respondia com o objeto criado ANTES de
   * saber se a mensagem saiu, enquanto gravava a falha no banco. As duas
   * versões existiam ao mesmo tempo, e o painel ficava com a errada.
   */
  it('a resposta já vem marcada como falha', async () => {
    const { service } = montar({
      falhaNoEnvio: 'o WhatsApp desta empresa está desconectado',
    });

    const mensagem = await service.sendAgentMessage('conversa-1', 'user-1', 'Oi');

    expect(mensagem.status).toBe('FAILED');
  });

  it('e traz o motivo junto, que é o que a tela mostra em vermelho', async () => {
    const { service } = montar({
      falhaNoEnvio: 'o WhatsApp desta empresa está desconectado',
    });

    const mensagem = await service.sendAgentMessage('conversa-1', 'user-1', 'Oi');

    expect((mensagem.metadata as { falha?: string })?.falha).toContain(
      'desconectado',
    );
  });

  it('envio que deu certo continua devolvendo o id externo', async () => {
    const { service } = montar();

    const mensagem = await service.sendAgentMessage('conversa-1', 'user-1', 'Oi');

    expect(mensagem.status).not.toBe('FAILED');
    expect(mensagem.externalId).toBe('wamid.NOVO');
  });
});
