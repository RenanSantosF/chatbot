import { BadRequestException } from '@nestjs/common';
import { CopilotService } from './copilot.service';

/**
 * O assistente do painel é a própria tela.
 *
 * Quem pergunta aqui é o dono da empresa, e ele não tem acesso a log de
 * servidor nenhum. Uma exceção que sobe vira "500 Internal server error"
 * na cara dele — foi o defeito que este arquivo existe pra não deixar
 * voltar. Falha da IA tem que virar FRASE, sempre.
 */
function montar(
  opcoes: {
    /** O que o provedor faz quando chamado. */
    provedor?: (entrada: {
      executeTool: (nome: string, args: object) => Promise<unknown>;
    }) => Promise<{ content: string }>;
    semChave?: boolean;
    /** Permissões que o papel TEM (o resto é negado). */
    permite?: string[];
    iaAtiva?: boolean;
    saudacaoLigada?: boolean;
  } = {},
) {
  const aiSettings =
    opcoes.iaAtiva === undefined ? null : { id: 'ia', active: opcoes.iaAtiva };
  const inbox = {
    get: jest
      .fn()
      .mockResolvedValue({ greetingEnabled: opcoes.saudacaoLigada ?? false }),
    update: jest.fn().mockResolvedValue({}),
  };
  const aiUpdate = jest.fn().mockResolvedValue({});
  const instrucoes = { create: jest.fn().mockResolvedValue({}) };
  const conversations = {
    transferTo: jest.fn().mockResolvedValue({}),
    transferToQueue: jest.fn().mockResolvedValue({}),
  };
  const generateReply = jest
    .fn()
    .mockImplementation(
      opcoes.provedor ?? (async () => ({ content: 'A fila está tranquila.' })),
    );

  const service = new CopilotService(
    {
      tenantId: 'tenant-teste',
      db: {
        aiSettings: {
          findFirst: jest.fn().mockResolvedValue(aiSettings),
          update: aiUpdate,
        },
        tenant: {
          findUnique: jest.fn().mockResolvedValue({ canal: 'EVOLUTION' }),
        },
        evolutionSettings: {
          findFirst: jest.fn().mockResolvedValue({
            estado: 'DESCONECTADO',
            connectedPhone: null,
            lastError: 'sessão expirou',
          }),
        },
        whatsAppSettings: { findFirst: jest.fn().mockResolvedValue(null) },
        billingAccount: {
          findFirst: jest.fn().mockResolvedValue({
            aiMonthlyMessageLimit: 5000,
            aiExtraMessagesThisPeriod: 0,
            aiRepliesUsed: 5000,
            aiUsagePeriodStart: new Date(),
            usedBytes: 19n * 1024n ** 3n,
            quotaBytes: 20n * 1024n ** 3n,
            planLabel: 'Pro',
            stripeSubscriptionId: 'sub_1',
          }),
        },
        retentionSettings: {
          findFirst: jest.fn().mockResolvedValue({
            autoPurgeOnFull: true,
            keepMessagesDays: null,
          }),
        },
        conversation: {
          groupBy: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([
            { id: 'c1', customer: { name: 'João' } },
            { id: 'c2', customer: { name: 'Maria' } },
          ]),
        },
        user: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'u-ana', name: 'Ana Paula' },
            { id: 'u-bruno', name: 'Bruno' },
          ]),
        },
        queue: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'q-fin', name: 'Financeiro' }]),
        },
      },
    } as never,
    {
      resolve: jest.fn().mockResolvedValue({
        active: true,
        credentials: opcoes.semChave ? null : { apiKey: 'chave', model: 'x' },
      }),
    } as never,
    inbox as never,
    {
      can: jest.fn((_role: string, chave: string) =>
        Promise.resolve(
          (
            opcoes.permite ?? ['whatsapp.manage', 'ai.manage', 'metrics.view']
          ).includes(chave),
        ),
      ),
    } as never,
    { generateReply },
    { visiveis: jest.fn().mockResolvedValue({}) } as never,
    instrucoes as never,
    {} as never,
    {} as never,
    {} as never,
    conversations as never,
  );

  return { service, generateReply, inbox, aiUpdate, instrucoes, conversations };
}

const quem = (role: string) =>
  ({
    userId: 'u-quem',
    tenantId: 'tenant-teste',
    role,
    email: 'x@x.com',
    name: 'Quem',
  }) as never;

/** Faz o "modelo" chamar uma ferramenta e devolve o que ela respondeu. */
async function usar(
  nome: string,
  args: object,
  opcoes: Parameters<typeof montar>[0] & { papel?: 'OWNER' | 'AGENT' } = {},
) {
  let resultado: unknown;
  const montado = montar({
    ...opcoes,
    provedor: async ({ executeTool }) => {
      resultado = await executeTool(nome, args);
      return { content: 'ok' };
    },
  });
  await montado.service.ask(
    [{ role: 'user', content: 'pedido' }],
    quem(opcoes.papel ?? 'OWNER'),
  );
  return {
    resultado: resultado as {
      output: Record<string, Record<string, unknown>>;
      error?: string;
    },
    ...montado,
  };
}

const perguntar = (service: CopilotService) =>
  service.ask(
    [{ role: 'user' as const, content: 'Como está a fila hoje?' }],
    quem('OWNER'),
  );

describe('o assistente do painel nunca devolve erro cru', () => {
  it('cota estourada vira a frase da cota, não uma exceção', async () => {
    const { service } = montar({
      provedor: async () => {
        throw new Error(
          '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}}',
        );
      },
    });

    const resposta = await perguntar(service);

    expect(resposta.falhou).toBe(true);
    expect(resposta.content).toMatch(/limite de uso/i);
  });

  it('chave recusada é sinalizada como problema da plataforma, não da empresa', async () => {
    const { service } = montar({
      provedor: async () => {
        throw new Error(
          '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}',
        );
      },
    });

    const resposta = await perguntar(service);

    expect(resposta.falhou).toBe(true);
    expect(resposta.content).toContain('suporte');
  });

  it('demora do provedor vira convite a tentar de novo', async () => {
    const { service } = montar({
      provedor: async () => {
        throw new Error(
          'O provedor de IA não respondeu em 25 segundos (copiloto).',
        );
      },
    });

    const resposta = await perguntar(service);

    expect(resposta.falhou).toBe(true);
    expect(resposta.content).toMatch(/demorou demais/i);
  });

  it('falha sem assinatura conhecida ainda vira frase', async () => {
    const { service } = montar({
      provedor: async () => {
        throw new TypeError('cannot read properties of undefined');
      },
    });

    const resposta = await perguntar(service);

    expect(resposta.falhou).toBe(true);
    expect(resposta.content.length).toBeGreaterThan(20);
  });

  it('resposta boa passa limpa, sem marca de falha', async () => {
    const { service } = montar();

    const resposta = await perguntar(service);

    expect(resposta.content).toBe('A fila está tranquila.');
    expect(resposta.falhou).toBeUndefined();
  });
});

describe('o balão nunca sai vazio', () => {
  it('mudou a configuração e o modelo não escreveu nada: confirma a mudança', async () => {
    const { service } = montar({
      provedor: async ({ executeTool }) => {
        // O modelo chama a ferramenta e devolve texto vazio — o caso real
        // em que a alteração JÁ aconteceu.
        await executeTool('ajustarAtendimento', { sendReadReceipts: false });
        return { content: '   ' };
      },
    });

    const resposta = await service.ask(
      [{ role: 'user', content: 'desliga a confirmação de leitura' }],
      quem('OWNER'),
    );

    expect(resposta.content).toMatch(/ajustei/i);
  });

  it('sem ferramenta e sem texto: diz que não conseguiu, em vez de balão vazio', async () => {
    const { service } = montar({ provedor: async () => ({ content: '' }) });

    const resposta = await perguntar(service);

    expect(resposta.content.trim().length).toBeGreaterThan(0);
    expect(resposta.content).toMatch(/não consegui/i);
  });
});

describe('sem chave configurada', () => {
  it('continua sendo pedido inválido, não falha de IA', async () => {
    const { service } = montar({ semChave: true });

    await expect(perguntar(service)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('o assistente respeita as permissões de quem pergunta', () => {
  it('atendente sem acesso à IA não recebe a ferramenta de mudar a IA', async () => {
    const { service, generateReply } = montar({ permite: [] });
    await service.ask(
      [{ role: 'user', content: 'desliga a IA' }],
      quem('AGENT'),
    );

    const [[entrada]] = generateReply.mock.calls as [
      [{ tools: { name: string }[] }],
    ];
    const nomes = entrada.tools.map((tool) => tool.name);
    expect(nomes).toEqual([
      'lerConfiguracoes',
      'lerSituacao',
      'lerEquipe',
      'lerAtalhos',
      // Ler conversa é de todo mundo (com o recorte de setor do Inbox), e
      // criar etiqueta é livre na tela também.
      'buscarConversas',
      'lerConversa',
      'proporEtiqueta',
    ]);
  });

  it('e mesmo que o modelo tente, a execução é recusada', async () => {
    let resultado: unknown;
    const { service } = montar({
      permite: [],
      provedor: async ({ executeTool }) => {
        resultado = await executeTool('ajustarIa', { active: false });
        return { content: 'ok' };
      },
    });
    await service.ask(
      [{ role: 'user', content: 'desliga a IA' }],
      quem('AGENT'),
    );
    expect(resultado).toEqual({
      error: 'Seu perfil não tem permissão para esta ação.',
    });
  });
});

describe('o assistente diz a situação da conta', () => {
  it('mostra WhatsApp desconectado e respostas do mês acabadas', async () => {
    const { resultado } = await usar('lerSituacao', {});

    expect(resultado.output.whatsapp).toMatchObject({
      conectado: false,
      ultimoErro: 'sessão expirou',
    });
    expect(resultado.output.respostasDeIaNoMes).toMatchObject({
      acabou: true,
      restantes: 0,
    });
    expect(resultado.output.armazenamento).toMatchObject({ porcento: 95 });
  });

  it('atendente não vê espaço nem plano', async () => {
    const { resultado } = await usar('lerSituacao', {}, { papel: 'AGENT' });

    expect(resultado.output.armazenamento).toBeUndefined();
    expect(resultado.output.plano).toBeUndefined();
  });
});

describe('o assistente só grava o que a tela aceitaria', () => {
  it('recusa valor fora da faixa, sem gravar nada', async () => {
    const { resultado, inbox } = await usar('ajustarAtendimento', {
      autoCloseHours: 48,
    });

    expect(resultado.error).toMatch(/inválido/);
    expect(inbox.update).not.toHaveBeenCalled();
  });

  it('grava o que é válido', async () => {
    const { resultado, inbox } = await usar('ajustarAtendimento', {
      autoCloseIdle: true,
      autoCloseHours: 12,
    });

    expect(resultado.output.ok).toBe(true);
    expect(inbox.update).toHaveBeenCalledWith({
      autoCloseIdle: true,
      autoCloseHours: 12,
    });
  });

  it('não liga a saudação automática com a IA ligada', async () => {
    const { resultado, inbox } = await usar(
      'ajustarAtendimento',
      { greetingEnabled: true },
      { iaAtiva: true },
    );

    expect(resultado.error).toMatch(/IA ligada/);
    expect(inbox.update).not.toHaveBeenCalled();
  });

  it('ligar a IA desliga a saudação, como a tela faz', async () => {
    const { resultado, inbox, aiUpdate } = await usar(
      'ajustarIa',
      { active: true },
      { iaAtiva: false, saudacaoLigada: true },
    );

    expect(aiUpdate).toHaveBeenCalled();
    expect(inbox.update).toHaveBeenCalledWith({ greetingEnabled: false });
    expect(resultado.output.observacao).toMatch(/saudação/);
  });
});

describe('o que muda o trabalho da equipe só acontece no clique', () => {
  const antes = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'segredo-de-teste';
  });
  afterAll(() => {
    process.env.JWT_SECRET = antes;
  });

  async function propor(nome: string, args: object) {
    let resultado: unknown;
    const montado = montar({
      permite: ['ai.manage', 'conversations.assign'],
      provedor: async ({ executeTool }) => {
        resultado = await executeTool(nome, args);
        return { content: 'Confira abaixo.' };
      },
    });
    const resposta = await montado.service.ask(
      [{ role: 'user', content: 'pedido' }],
      quem('ADMIN'),
    );
    return { ...montado, resposta, resultado };
  }

  it('"passa as do financeiro pra Ana" vira proposta, e nada é transferido antes', async () => {
    const { resposta, conversations } = await propor('proporDistribuicao', {
      doSetor: 'financeiro',
      paraPessoa: 'ana',
    });

    expect(resposta.propostas).toHaveLength(1);
    expect(resposta.propostas?.[0].titulo).toBe(
      'Passar 2 conversas para Ana Paula',
    );
    expect(conversations.transferTo).not.toHaveBeenCalled();
  });

  it('confirmar executa com quem clicou, conversa por conversa', async () => {
    const { resposta, service, conversations } = await propor(
      'proporDistribuicao',
      { doSetor: 'financeiro', paraPessoa: 'ana' },
    );

    const feito = await service.confirmar(
      resposta.propostas![0].token,
      quem('ADMIN'),
    );

    expect(conversations.transferTo).toHaveBeenCalledTimes(2);
    expect(conversations.transferTo).toHaveBeenCalledWith(
      'c1',
      'u-ana',
      'u-quem',
      { userId: 'u-quem', role: 'ADMIN' },
    );
    expect(feito.content).toMatch(/2 conversas passadas para Ana Paula/);
  });

  it('a mesma proposta não executa duas vezes (clique duplo)', async () => {
    const { resposta, service } = await propor('proporEnsinamento', {
      titulo: 'Preço do clareamento',
      texto: 'O clareamento custa R$ 800, em até 3x.',
    });
    const token = resposta.propostas![0].token;

    await service.confirmar(token, quem('ADMIN'));
    await expect(service.confirmar(token, quem('ADMIN'))).rejects.toThrow(
      /já foi confirmada/,
    );
  });

  it('ensinar a IA grava só depois de confirmar', async () => {
    const { resposta, service, instrucoes } = await propor(
      'proporEnsinamento',
      {
        titulo: 'Preço do clareamento',
        texto: 'O clareamento custa R$ 800, em até 3x.',
      },
    );
    expect(instrucoes.create).not.toHaveBeenCalled();

    await service.confirmar(resposta.propostas![0].token, quem('ADMIN'));

    expect(instrucoes.create).toHaveBeenCalledWith({
      title: 'Preço do clareamento',
      content: 'O clareamento custa R$ 800, em até 3x.',
    });
  });

  it('a proposta de uma pessoa não serve pra outra', async () => {
    const { resposta, service } = await propor('proporEnsinamento', {
      titulo: 'Horário',
      texto: 'Abrimos às 8h.',
    });

    await expect(
      service.confirmar(resposta.propostas![0].token, {
        ...(quem('ADMIN') as object),
        userId: 'outra-pessoa',
      } as never),
    ).rejects.toThrow(/não é sua/);
  });

  it('nome que não existe não vira palpite: devolve as opções', async () => {
    const { resultado, resposta } = await propor('proporDistribuicao', {
      doSetor: 'financeiro',
      paraPessoa: 'Carlos',
    });

    expect(resposta.propostas).toBeUndefined();
    expect((resultado as { error: string }).error).toMatch(
      /Nenhum encontrado.*Ana Paula, Bruno/,
    );
  });
});
