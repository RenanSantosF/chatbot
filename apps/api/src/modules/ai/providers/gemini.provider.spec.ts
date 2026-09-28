import { ApiError, ThinkingLevel } from '@google/genai';
import { GeminiProvider, configDeRaciocinio } from './gemini.provider';

/**
 * O raciocínio no mínimo, pedido do jeito que cada geração aceita.
 *
 * O defeito que isto cobre: o sistema mandava `thinkingBudget: 0` pra
 * todo modelo, e o Gemini 3.x recusa isso com um 400 INVALID_ARGUMENT —
 * a IA parou de responder inteira.
 */
describe('configDeRaciocinio', () => {
  it('Gemini 3.x vai de thinkingLevel MINIMAL, nunca de thinkingBudget', () => {
    expect(configDeRaciocinio('gemini-3.1-flash-lite')).toEqual({
      thinkingLevel: ThinkingLevel.MINIMAL,
    });
    expect(configDeRaciocinio('gemini-3-flash-preview')).toEqual({
      thinkingLevel: ThinkingLevel.MINIMAL,
    });
  });

  it('Gemini 2.5 continua desligando com thinkingBudget 0', () => {
    expect(configDeRaciocinio('gemini-2.5-flash')).toEqual({
      thinkingBudget: 0,
    });
  });

  it('antes da 2.5 não há raciocínio pra configurar', () => {
    expect(configDeRaciocinio('gemini-2.0-flash')).toBeUndefined();
  });

  it('alias sem versão é tratado como a geração atual', () => {
    expect(configDeRaciocinio('gemini-flash-latest')).toEqual({
      thinkingLevel: ThinkingLevel.MINIMAL,
    });
  });
});

describe('GeminiProvider — modelo que recusa MINIMAL', () => {
  const recusa = () =>
    new ApiError({
      message: '{"error":{"code":400,"status":"INVALID_ARGUMENT"}}',
      status: 400,
    });

  function clienteFalso(recusaMinimal: boolean) {
    const niveis: unknown[] = [];
    const generateContent = jest.fn(
      (params: {
        config?: { thinkingConfig?: { thinkingLevel?: string } };
      }) => {
        const nivel = params.config?.thinkingConfig?.thinkingLevel;
        niveis.push(nivel);
        if (recusaMinimal && nivel === ThinkingLevel.MINIMAL) {
          return Promise.reject(recusa());
        }
        return Promise.resolve({ text: 'ok' });
      },
    );
    return { client: { models: { generateContent } }, niveis };
  }

  type ComGerar = {
    gerarConteudo: (c: unknown, p: unknown) => Promise<{ text: string }>;
  };

  it('tenta LOW depois do 400 e lembra pra próxima vez', async () => {
    const provider = new GeminiProvider() as unknown as ComGerar;
    const { client, niveis } = clienteFalso(true);

    await expect(
      provider.gerarConteudo(client, {
        model: 'gemini-3.9-teste',
        contents: [],
      }),
    ).resolves.toEqual({ text: 'ok' });
    await provider.gerarConteudo(client, {
      model: 'gemini-3.9-teste',
      contents: [],
    });

    // Primeira: MINIMAL recusado, LOW aceito. Segunda: direto em LOW.
    expect(niveis).toEqual([
      ThinkingLevel.MINIMAL,
      ThinkingLevel.LOW,
      ThinkingLevel.LOW,
    ]);
  });

  it('modelo que aceita MINIMAL faz uma chamada só', async () => {
    const provider = new GeminiProvider() as unknown as ComGerar;
    const { client, niveis } = clienteFalso(false);

    await provider.gerarConteudo(client, {
      model: 'gemini-3.1-flash-lite',
      contents: [],
    });
    expect(niveis).toEqual([ThinkingLevel.MINIMAL]);
  });
});
