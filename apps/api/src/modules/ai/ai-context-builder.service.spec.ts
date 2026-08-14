import { AiContextBuilder } from './ai-context-builder.service';

/**
 * A montagem do contexto, com o banco de mentira.
 *
 * O que se testa aqui é a ligação entre as decisões: o que é lido do
 * banco, o que é filtrado antes de chegar no modelo, e quando a busca na
 * base de conhecimento é acionada. Cada item destes é uma linha na conta
 * do fim do mês ou uma resposta errada pro cliente.
 */
function montar(
  opcoes: {
    mensagens?: Record<string, unknown>[];
    cliente?: Record<string, unknown> | null;
    trechos?: { content: string; documentTitle: string }[];
    camposFaltando?: string[];
    aiSettings?: Record<string, unknown> | null;
    /** Quando o atendimento foi reaberto, se foi. */
    reaberturaEm?: Date;
  } = {},
) {
  const buscas: string[] = [];
  let whereDasMensagens: Record<string, unknown> = {};

  const prisma = {
    client: {
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'tenant-teste',
          name: 'Escritório Exemplo',
          timezone: 'America/Sao_Paulo',
        }),
      },
    },
  };

  const tenantPrisma = {
    tenantId: 'tenant-teste',
    db: {
      message: {
        findMany: jest
          .fn()
          .mockImplementation((args: { where: Record<string, unknown> }) => {
            whereDasMensagens = args.where;
            return opcoes.mensagens ?? [];
          }),
        // A busca pela nota de reabertura, que marca onde começa o
        // atendimento atual. Sem reabertura, o histórico é a conversa
        // inteira — que é o caso de quase todo teste daqui.
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opcoes.reaberturaEm ? { createdAt: opcoes.reaberturaEm } : null,
          ),
      },
      aiSettings: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            'aiSettings' in opcoes
              ? opcoes.aiSettings
              : { aiName: 'Clara', tone: 'FRIENDLY' },
          ),
      },
      aiInstruction: { findMany: jest.fn().mockResolvedValue([]) },
      conversation: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            'cliente' in opcoes
              ? opcoes.cliente
              : { customer: { name: 'Ana Souza', metadata: {} } },
          ),
      },
    },
  };

  const knowledge = {
    searchRelevantChunks: jest.fn().mockImplementation((pergunta: string) => {
      buscas.push(pergunta);
      return opcoes.trechos ?? [];
    }),
  };
  const collection = {
    missingRequired: jest.fn().mockResolvedValue(opcoes.camposFaltando ?? []),
  };

  const builder = new AiContextBuilder(
    prisma as never,
    tenantPrisma as never,
    knowledge as never,
    collection as never,
  );

  return {
    builder,
    buscas,
    knowledge,
    quandoLeuMensagens: () => whereDasMensagens,
  };
}

const msg = (extra: Record<string, unknown> = {}) => ({
  content: 'Oi',
  messageType: 'TEXT',
  senderType: 'CUSTOMER',
  // Todas no mesmo instante por padrão: só os testes que falam de intervalo
  // de tempo é que precisam de horas diferentes.
  createdAt: new Date('2026-08-14T12:00:00Z'),
  replyTo: null,
  ...extra,
});

describe('o que NÃO chega no modelo', () => {
  it('mensagem apagada é excluída na consulta', async () => {
    // O painel já esconde o conteúdo. Mandá-lo pro modelo faria a IA
    // repetir pro cliente exatamente o texto que alguém apagou pra ele
    // não ver de novo.
    const { builder, quandoLeuMensagens } = montar();

    await builder.build('conversa-1');

    expect(quandoLeuMensagens()).toMatchObject({ deletedAt: null });
  });

  it('nota interna do sistema é excluída na consulta', async () => {
    // "Encaminhado para o setor Financeiro" é recado pra equipe; pro
    // modelo é ruído que ele às vezes repete pro cliente.
    const { builder, quandoLeuMensagens } = montar();

    await builder.build('conversa-1');

    expect(quandoLeuMensagens()).toMatchObject({
      senderType: { not: 'SYSTEM' },
    });
  });

  it('turno que ficaria vazio some do histórico', async () => {
    const { builder } = montar({
      mensagens: [msg({ content: '   ' }), msg({ content: 'quanto custa?' })],
    });

    const { history } = await builder.build('conversa-1');

    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('quanto custa?');
  });
});

describe('busca na base de conhecimento', () => {
  it('não acontece quando a última fala é cortesia', async () => {
    const { builder, knowledge } = montar({
      mensagens: [msg({ content: 'obrigado!' })],
    });

    await builder.build('conversa-1');

    expect(knowledge.searchRelevantChunks).not.toHaveBeenCalled();
  });

  it('acontece quando é pergunta de verdade', async () => {
    const { builder, buscas } = montar({
      mensagens: [msg({ content: 'vocês atendem aos sábados?' })],
    });

    await builder.build('conversa-1');

    expect(buscas).toEqual(['vocês atendem aos sábados?']);
  });

  it('busca pela última fala DO CLIENTE, não pela última da conversa', async () => {
    const { builder, buscas } = montar({
      mensagens: [
        msg({ content: 'qual o prazo do processo?' }),
        msg({ content: 'Deixa eu verificar', senderType: 'AI' }),
      ],
    });

    await builder.build('conversa-1');

    expect(buscas).toEqual(['qual o prazo do processo?']);
  });

  it('conversa sem fala do cliente não busca nada', async () => {
    const { builder, knowledge } = montar({
      mensagens: [
        msg({ content: 'Olá, em que posso ajudar?', senderType: 'AI' }),
      ],
    });

    await builder.build('conversa-1');

    expect(knowledge.searchRelevantChunks).not.toHaveBeenCalled();
  });

  it('falha na busca não derruba a resposta', async () => {
    // Base de conhecimento é complemento. Sem ela a IA responde pior;
    // com uma exceção, o cliente não recebe nada.
    const { builder, knowledge } = montar({
      mensagens: [msg({ content: 'qual o horário de vocês?' })],
    });
    knowledge.searchRelevantChunks.mockRejectedValue(
      new Error('pgvector fora'),
    );

    const { history } = await builder.build('conversa-1');
    expect(history).toHaveLength(1);
  });
});

describe('o que a IA passa a saber', () => {
  it('sabe que dia e que horas são', async () => {
    const { builder } = montar();

    const { systemPrompt } = await builder.build('conversa-1');

    expect(systemPrompt).toContain('fuso da empresa');
    expect(systemPrompt).toMatch(/de \w+ de \d{4}/);
  });

  it('sabe o nome de quem está falando', async () => {
    const { builder } = montar();

    const { systemPrompt } = await builder.build('conversa-1');

    expect(systemPrompt).toContain('Ana Souza');
  });

  it('não chama o cliente pelo número quando ele não tem nome', async () => {
    const { builder } = montar({
      cliente: { customer: { name: '5527999998888', metadata: {} } },
    });

    const { systemPrompt } = await builder.build('conversa-1');

    expect(systemPrompt).not.toContain('5527999998888');
  });

  it('recebe os trechos da base quando há pergunta', async () => {
    const { builder } = montar({
      mensagens: [msg({ content: 'qual o valor da consulta?' })],
      trechos: [
        { content: 'A consulta custa R$ 300.', documentTitle: 'Tabela' },
      ],
    });

    const { systemPrompt } = await builder.build('conversa-1');

    expect(systemPrompt).toContain('A consulta custa R$ 300.');
    expect(systemPrompt).toContain('[Tabela]');
  });

  it('sabe o que ainda falta coletar', async () => {
    const { builder } = montar({
      camposFaltando: ['CPF', 'Número do processo'],
    });

    const { systemPrompt } = await builder.build('conversa-1');

    expect(systemPrompt).toContain('CPF, Número do processo');
    expect(systemPrompt).toContain('collectCustomerData');
  });

  it('a memória desligada apaga o que já estava guardado, não só o novo', async () => {
    const { builder } = montar({
      aiSettings: { aiName: 'Clara', tone: 'FRIENDLY', memoryMode: 'NONE' },
      cliente: {
        customer: { name: 'Ana', metadata: { profissao: 'advogada' } },
      },
    });

    const { systemPrompt } = await builder.build('conversa-1');

    expect(systemPrompt).not.toContain('advogada');
  });

  it('usa a memória quando ela está ligada', async () => {
    const { builder } = montar({
      cliente: {
        customer: { name: 'Ana', metadata: { profissao: 'advogada' } },
      },
    });

    const { systemPrompt } = await builder.build('conversa-1');

    expect(systemPrompt).toContain('advogada');
  });
});

describe('histórico entregue ao modelo', () => {
  it('vem em ordem cronológica, do mais antigo pro mais novo', async () => {
    // A consulta traz do mais novo pro mais velho (é assim que se pega a
    // última página); entregar nessa ordem faria a IA ler a conversa de
    // trás pra frente.
    const { builder } = montar({
      mensagens: [
        msg({ content: 'terceira' }),
        msg({ content: 'segunda', senderType: 'AI' }),
        msg({ content: 'primeira' }),
      ],
    });

    const { history } = await builder.build('conversa-1');

    expect(history.map((h) => h.content)).toEqual([
      'primeira',
      'segunda',
      'terceira',
    ]);
  });

  it('atendente e IA são o mesmo lado pro modelo', async () => {
    // Pro LLM, ambos são "o negócio falando" — separar confundiria a
    // alternância de turnos.
    // Na ordem em que o banco devolve: da mais nova pra mais velha.
    const { builder } = montar({
      mensagens: [
        msg({ content: 'resposta do atendente', senderType: 'AGENT' }),
        msg({ content: 'resposta da IA', senderType: 'AI' }),
        msg({ content: 'oi' }),
      ],
    });

    const { history } = await builder.build('conversa-1');

    expect(history).toEqual([
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'resposta da IA\nresposta do atendente' },
    ]);
  });

  it('traz a citação junto, porque a original pode estar fora da janela', async () => {
    // "sim, esse mesmo" sem a citação chega sem nada a que se referir.
    const { builder } = montar({
      mensagens: [
        msg({
          content: 'sim, esse mesmo',
          replyTo: { content: 'O processo 0001234-55?', senderType: 'AI' },
        }),
      ],
    });

    const { history } = await builder.build('conversa-1');

    expect(history[0].content).toContain('O processo 0001234-55?');
    expect(history[0].content).toContain('sim, esse mesmo');
  });

  it('anexo sem legenda vira marcador, não turno em branco', async () => {
    const { builder } = montar({
      mensagens: [msg({ content: '', messageType: 'IMAGE' })],
    });

    const { history } = await builder.build('conversa-1');

    expect(history[0].content).toContain('imagem');
  });
});
