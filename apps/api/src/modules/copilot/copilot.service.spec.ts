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
  );

  return { service, generateReply, inbox, aiUpdate };
}

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
    opcoes.papel ?? 'OWNER',
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
    'OWNER',
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
      'OWNER',
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
    await service.ask([{ role: 'user', content: 'desliga a IA' }], 'AGENT');

    const [[entrada]] = generateReply.mock.calls as [
      [{ tools: { name: string }[] }],
    ];
    const nomes = entrada.tools.map((tool) => tool.name);
    expect(nomes).toEqual([
      'lerConfiguracoes',
      'lerSituacao',
      'lerEquipe',
      'lerAtalhos',
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
    await service.ask([{ role: 'user', content: 'desliga a IA' }], 'AGENT');
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
