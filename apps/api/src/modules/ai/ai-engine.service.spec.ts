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

/**
 * O motor com uma resposta escolhida pelo teste.
 *
 * Serve pra provar a única trava que mexe NO TEXTO: a resposta com dado
 * inventado não pode sair do motor como o modelo escreveu, porque quem
 * recebe grava e manda pro cliente sem olhar de novo.
 */
function motorQueResponde(conteudo: string, prompt: string) {
  const service = new AiEngineService(
    {
      build: jest.fn().mockResolvedValue({
        systemPrompt: prompt,
        history: [{ role: 'user', content: 'Onde fica o escritório?' }],
      }),
    } as never,
    {
      resolve: jest
        .fn()
        .mockResolvedValue({ active: true, credentials: { apiKey: 'chave' } }),
    } as never,
    { getEnabledDeclarations: jest.fn().mockResolvedValue([]) } as never,
    { generateReply: jest.fn().mockResolvedValue({ content: conteudo }) },
  );
  return service;
}

describe('AiEngineService.generateReply — dado inventado não sai', () => {
  const INVENTADO =
    'O nosso escritório fica na Avenida Paulista, nº 1000, Bela Vista - São Paulo/SP.';

  it('substitui a resposta antes de ela chegar em quem envia', async () => {
    const service = motorQueResponde(
      INVENTADO,
      'Você é a assistente do escritório. Atendemos das 08h às 17h.',
    );

    const resultado = await service.generateReply('conversa-1');

    expect(resultado.tipo).toBe('respondeu');
    if (resultado.tipo !== 'respondeu') return;
    expect(resultado.resposta.content).not.toContain('Paulista');
    expect(resultado.resposta.verificacao.precisaHandoff).toBe(true);
  });

  it('não mexe na resposta quando o endereço veio da base', async () => {
    const service = motorQueResponde(
      'Ficamos na Avenida Paulista, 1000.',
      'Você é a assistente.\n[Base] Endereço: Av. Paulista, 1000 - São Paulo.',
    );

    const resultado = await service.generateReply('conversa-1');

    expect(resultado.tipo).toBe('respondeu');
    if (resultado.tipo !== 'respondeu') return;
    expect(resultado.resposta.content).toBe('Ficamos na Avenida Paulista, 1000.');
  });

  it('o histórico conta como fonte: repetir o dado do cliente é permitido', async () => {
    const service = new AiEngineService(
      {
        build: jest.fn().mockResolvedValue({
          systemPrompt: 'Você é a assistente.',
          history: [
            { role: 'user', content: 'meu telefone é (27) 3333-4444' },
            { role: 'user', content: 'confere?' },
          ],
        }),
      } as never,
      {
        resolve: jest
          .fn()
          .mockResolvedValue({ active: true, credentials: { apiKey: 'chave' } }),
      } as never,
      { getEnabledDeclarations: jest.fn().mockResolvedValue([]) } as never,
      {
        generateReply: jest
          .fn()
          .mockResolvedValue({ content: 'Confirmado: (27) 3333-4444.' }),
      },
    );

    const resultado = await service.generateReply('conversa-1');

    expect(resultado.tipo).toBe('respondeu');
    if (resultado.tipo !== 'respondeu') return;
    expect(resultado.resposta.content).toBe('Confirmado: (27) 3333-4444.');
  });
});

describe('a IA agiu e não escreveu nada', () => {
  /**
   * O silêncio real: o cliente perguntou o endereço, a IA transferiu pro
   * setor Jurídico corretamente e não mandou uma palavra. A conversa foi
   * pra fila certa, com o motivo certo, e do lado do cliente foi uma
   * pergunta ignorada.
   */
  function motorSemTexto(ferramenta: string) {
    return new AiEngineService(
      {
        build: jest.fn().mockResolvedValue({
          systemPrompt: 'Você é a assistente.',
          history: [{ role: 'user', content: 'Onde fica o escritório?' }],
        }),
      } as never,
      {
        resolve: jest
          .fn()
          .mockResolvedValue({ active: true, credentials: { apiKey: 'chave' } }),
      } as never,
      {
        getEnabledDeclarations: jest
          .fn()
          .mockResolvedValue([
            { name: ferramenta, description: '', parametersSchema: {} },
          ]),
        execute: jest.fn().mockResolvedValue({ output: { status: 'ok' } }),
      } as never,
      {
        generateReply: jest.fn(
          async (input: { executeTool?: AiToolExecutor }) => {
            await input.executeTool?.(ferramenta, {});
            return { content: '' };
          },
        ),
      },
    );
  }

  it('avisa o cliente de que alguém assume, quando transferiu', async () => {
    const resultado = await motorSemTexto('transferToQueue').generateReply(
      'conversa-1',
    );

    expect(resultado.tipo).toBe('respondeu');
    if (resultado.tipo !== 'respondeu') return;
    expect(resultado.resposta.content).toContain('equipe');
  });

  it('se despede, quando encerrou', async () => {
    const resultado = await motorSemTexto('resolveConversation').generateReply(
      'conversa-1',
    );

    expect(resultado.tipo).toBe('respondeu');
    if (resultado.tipo !== 'respondeu') return;
    expect(resultado.resposta.content).toContain('encerrado');
  });

  it('sem texto E sem ação, aí sim é a IA indisponível', async () => {
    // Nada a anunciar: inventar uma cortesia genérica só empurraria o
    // problema pro cliente em vez de chamar alguém.
    const service = new AiEngineService(
      {
        build: jest.fn().mockResolvedValue({
          systemPrompt: 'Você é a assistente.',
          history: [{ role: 'user', content: 'oi' }],
        }),
      } as never,
      {
        resolve: jest
          .fn()
          .mockResolvedValue({ active: true, credentials: { apiKey: 'chave' } }),
      } as never,
      { getEnabledDeclarations: jest.fn().mockResolvedValue([]) } as never,
      { generateReply: jest.fn().mockResolvedValue({ content: '  ' }) },
    );

    const resultado = await service.generateReply('conversa-1');

    expect(resultado.tipo).toBe('indisponivel');
  });
});

describe('resposta meio certa não é jogada fora', () => {
  it('manda o que tem lastro e avisa que o resto vem de uma pessoa', async () => {
    const service = new AiEngineService(
      {
        build: jest.fn().mockResolvedValue({
          systemPrompt: '[Instruções] Horário: segunda a sexta, das 08h às 17h.',
          history: [{ role: 'user', content: 'Qual horário vocês atendem?' }],
        }),
      } as never,
      {
        resolve: jest
          .fn()
          .mockResolvedValue({ active: true, credentials: { apiKey: 'chave' } }),
      } as never,
      { getEnabledDeclarations: jest.fn().mockResolvedValue([]) } as never,
      {
        generateReply: jest.fn().mockResolvedValue({
          content:
            'Atendemos de segunda a sexta, das 08h às 17h. A consulta custa R$ 350,00.',
        }),
      },
    );

    const resultado = await service.generateReply('conversa-1');

    expect(resultado.tipo).toBe('respondeu');
    if (resultado.tipo !== 'respondeu') return;
    // O que a empresa sabe responder chega ao cliente...
    expect(resultado.resposta.content).toContain('08h às 17h');
    // ...o que ela não sabe, não chega...
    expect(resultado.resposta.content).not.toContain('350');
    // ...e alguém é chamado pro que ficou faltando.
    expect(resultado.resposta.verificacao.precisaHandoff).toBe(true);
  });
});
