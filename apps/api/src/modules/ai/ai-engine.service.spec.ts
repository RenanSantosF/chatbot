import { AiEngineService, executouDeVerdade } from './ai-engine.service';
import type { AiToolExecutor } from './providers/ai-provider.interface';

/**
 * O motor decide DUAS coisas que quebram o atendimento quando erram: se a
 * IA responde, e se o que ela fez confere com o que ela disse.
 *
 * O segundo ponto é o que estes testes guardam. A trava de handoff compara
 * a promessa do texto com as ferramentas executadas — então "executada"
 * precisa querer dizer "produziu efeito". Uma transferência barrada
 * contando como transferência feita reabre exatamente o defeito que as
 * travas existem pra fechar: o cliente é avisado de que alguém assume, a
 * IA para de responder, e ninguém é chamado.
 */

describe('executouDeVerdade', () => {
  it('conta a ferramenta que rodou e devolveu resultado', () => {
    expect(executouDeVerdade({ output: { status: 'transferred' } })).toBe(true);
  });

  it('não conta quando o executor recusou', () => {
    // Permissão DENY, ferramenta desconhecida, exceção no meio.
    expect(
      executouDeVerdade({ error: 'Esta ferramenta não está disponível.' }),
    ).toBe(false);
  });

  it('não conta a transferência barrada pela coleta obrigatória', () => {
    // A ferramenta rodou, mas se recusou a agir e devolveu a lista do que
    // falta justamente pra a IA voltar e perguntar.
    expect(
      executouDeVerdade({
        output: { status: 'blocked', missing: ['CPF'], error: 'colete o CPF' },
      }),
    ).toBe(false);
  });

  it('não conta gravação que não gravou nada', () => {
    expect(executouDeVerdade({ output: { status: 'nothing_to_save' } })).toBe(
      false,
    );
  });

  it('não quebra com saída que não é objeto', () => {
    expect(executouDeVerdade({ output: 'ok' })).toBe(true);
    expect(executouDeVerdade({ output: null })).toBe(true);
    expect(executouDeVerdade({})).toBe(true);
  });
});

/**
 * Monta o motor com tudo falso e devolve o executor que ele entrega ao
 * provedor — é ali que a contagem de ferramentas acontece.
 */
function motorCom(resultadoDaFerramenta: { output?: unknown; error?: string }) {
  const execute = jest.fn().mockResolvedValue(resultadoDaFerramenta);

  const credentials = {
    resolve: jest
      .fn()
      .mockResolvedValue({ active: true, credentials: { apiKey: 'chave' } }),
  };
  const contextBuilder = {
    build: jest.fn().mockResolvedValue({
      systemPrompt: 'prompt',
      history: [{ role: 'user', content: 'preciso falar com alguém' }],
    }),
  };
  const tools = {
    getEnabledDeclarations: jest
      .fn()
      .mockResolvedValue([
        { name: 'transferToQueue', description: '', parametersSchema: {} },
      ]),
    execute,
  };

  let executorCapturado: AiToolExecutor | undefined;
  const provider = {
    generateReply: jest.fn(async (input: { executeTool?: AiToolExecutor }) => {
      executorCapturado = input.executeTool;
      // O provedor de verdade chama a ferramenta no meio da geração; aqui a
      // chamada é explícita pra o teste controlar o resultado dela.
      await input.executeTool?.('transferToQueue', {});
      return { content: 'Vou transferir você para a equipe agora.' };
    }),
  };

  const service = new AiEngineService(
    contextBuilder as never,
    credentials as never,
    tools as never,
    provider,
  );

  return { service, execute, provider, executor: () => executorCapturado };
}

describe('AiEngineService.generateReply — travas e ferramentas', () => {
  it('não escala de novo quando a transferência realmente aconteceu', async () => {
    const { service } = motorCom({ output: { status: 'transferred' } });

    const resultado = await service.generateReply('conversa-1');

    expect(resultado.tipo).toBe('respondeu');
    if (resultado.tipo !== 'respondeu') return;
    expect(resultado.resposta.verificacao.precisaHandoff).toBe(false);
  });

  it('escala quando a transferência foi barrada pela coleta obrigatória', async () => {
    // Este é o defeito: a IA prometeu, a ferramenta não transferiu, e sem
    // a trava a conversa ficava sem IA e sem gente.
    const { service } = motorCom({
      output: { status: 'blocked', missing: ['CPF'] },
    });

    const resultado = await service.generateReply('conversa-1');

    expect(resultado.tipo).toBe('respondeu');
    if (resultado.tipo !== 'respondeu') return;
    expect(resultado.resposta.verificacao.precisaHandoff).toBe(true);
  });

  it('escala quando a ferramenta foi negada por permissão', async () => {
    const { service } = motorCom({
      error: 'Esta ação exige aprovação de um humano antes de acontecer.',
    });

    const resultado = await service.generateReply('conversa-1');

    expect(resultado.tipo).toBe('respondeu');
    if (resultado.tipo !== 'respondeu') return;
    expect(resultado.resposta.verificacao.precisaHandoff).toBe(true);
  });

  it('devolve pro provedor o resultado da ferramenta, mesmo quando não contou', async () => {
    // Não contar pra trava é uma coisa; esconder o motivo da IA é outra —
    // é lendo "colete o CPF" que ela volta e pergunta.
    const barrada = { output: { status: 'blocked', missing: ['CPF'] } };
    const { service, executor } = motorCom(barrada);

    await service.generateReply('conversa-1');

    await expect(executor()?.('transferToQueue', {})).resolves.toEqual(barrada);
  });
});

describe('AiEngineService.generateReply — quando a IA não responde', () => {
  function motorSemResposta(overrides: {
    active?: boolean;
    credentials?: unknown;
    history?: { role: string; content: string }[];
  }) {
    const credentials = {
      resolve: jest.fn().mockResolvedValue({
        active: overrides.active ?? true,
        // `in` e não `??`: o teste da chave ausente passa `null` de
        // propósito, e um `??` cairia no padrão justamente nele.
        credentials:
          'credentials' in overrides
            ? overrides.credentials
            : { apiKey: 'chave' },
      }),
    };
    const contextBuilder = {
      build: jest.fn().mockResolvedValue({
        systemPrompt: 'prompt',
        history: overrides.history ?? [{ role: 'user', content: 'oi' }],
      }),
    };
    const tools = {
      getEnabledDeclarations: jest.fn().mockResolvedValue([]),
      execute: jest.fn(),
    };
    const provider = {
      generateReply: jest.fn().mockResolvedValue({ content: 'olá' }),
    };

    return {
      service: new AiEngineService(
        contextBuilder as never,
        credentials as never,
        tools as never,
        provider,
      ),
      provider,
    };
  }

  it('diz que está indisponível quando a IA foi desligada — e não fica em silêncio', async () => {
    // Silêncio aqui deixava o cliente falando sozinho: ninguém era chamado
    // porque ninguém sabia que precisava chamar.
    const { service } = motorSemResposta({ active: false });
    const resultado = await service.generateReply('conversa-1');

    expect(resultado.tipo).toBe('indisponivel');
  });

  it('diz que está indisponível quando falta a chave de API', async () => {
    const { service } = motorSemResposta({ credentials: null });
    const resultado = await service.generateReply('conversa-1');

    expect(resultado.tipo).toBe('indisponivel');
  });

  it('não acorda ninguém quando a última fala já era da casa', async () => {
    // "semPergunta" é normal: não há nada a responder, e escalar isso
    // encheria a fila de conversas que ninguém precisa olhar.
    const { service } = motorSemResposta({
      history: [{ role: 'assistant', content: 'posso ajudar em mais algo?' }],
    });
    const resultado = await service.generateReply('conversa-1');

    expect(resultado.tipo).toBe('semPergunta');
  });

  it('falha do provedor vira indisponível, não exceção', async () => {
    // Quebrar o recebimento da mensagem do cliente é pior do que ficar sem
    // resposta automática.
    const { service, provider } = motorSemResposta({});
    provider.generateReply.mockRejectedValue(new Error('502 do provedor'));

    const resultado = await service.generateReply('conversa-1');

    expect(resultado.tipo).toBe('indisponivel');
  });
});
