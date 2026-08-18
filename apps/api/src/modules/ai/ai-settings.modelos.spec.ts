import { AiSettingsService } from './ai-settings.service';
import { MODELO_PADRAO } from './modelos';

/**
 * De onde sai a lista do seletor de modelo.
 *
 * O ponto delicado aqui não é o caminho feliz: é que NADA disto pode
 * derrubar a tela de configuração. Sem chave, com o Google fora do ar ou
 * com a chave recusada, o dono precisa continuar conseguindo abrir a tela
 * e escolher — mesmo que a lista seja só a recomendada.
 */
function montar(apiKeyEncrypted: string | null) {
  const prisma = {
    tenantId: 't',
    db: {
      aiSettings: {
        findFirst: jest.fn().mockResolvedValue({ id: 'a', apiKeyEncrypted }),
        create: jest.fn(),
      },
    },
  };
  const encryption = { decrypt: jest.fn().mockReturnValue('chave-real') };

  return new AiSettingsService(prisma as never, encryption as never);
}

const responder = (body: unknown, ok = true, status = 200) =>
  jest.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) });

const modeloDoGoogle = (name: string, metodos = ['generateContent']) => ({
  name: `models/${name}`,
  supportedGenerationMethods: metodos,
});

describe('lista de modelos', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sem chave configurada, devolve os recomendados sem chamar o Google', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = montar(null);

    const { modelos, verificado } = await service.listarModelos();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(verificado).toBe(false);
    expect(modelos[0].id).toBe(MODELO_PADRAO);
  });

  it('com chave, devolve o que o Google respondeu', async () => {
    global.fetch = responder({
      models: [modeloDoGoogle('gemini-9.9-pro'), modeloDoGoogle(MODELO_PADRAO)],
    }) as never;
    const service = montar('cifrada');

    const { modelos, verificado } = await service.listarModelos();

    expect(verificado).toBe(true);
    expect(modelos.map((m) => m.id)).toEqual([MODELO_PADRAO, 'gemini-9.9-pro']);
  });

  it('a chave vai no cabeçalho, nunca na URL', async () => {
    // Chave em querystring vaza pro log de qualquer proxy no caminho.
    const fetchSpy = responder({ models: [modeloDoGoogle(MODELO_PADRAO)] });
    global.fetch = fetchSpy as never;

    await montar('cifrada').listarModelos();

    const [url, opcoes] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('chave-real');
    expect((opcoes.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'chave-real',
    );
  });

  it('descarta o que não sabe responder a um cliente', async () => {
    // Modelo de embedding vive na mesma conta e nunca vai gerar resposta.
    global.fetch = responder({
      models: [
        modeloDoGoogle('gemini-embedding-001', ['embedContent']),
        modeloDoGoogle(MODELO_PADRAO),
      ],
    }) as never;

    const { modelos } = await montar('cifrada').listarModelos();

    expect(modelos.map((m) => m.id)).toEqual([MODELO_PADRAO]);
  });

  it('Google recusando a chave não derruba a tela', async () => {
    global.fetch = responder({}, false, 403) as never;

    const { modelos, verificado } = await montar('cifrada').listarModelos();

    expect(verificado).toBe(false);
    expect(modelos[0].id).toBe(MODELO_PADRAO);
  });

  it('Google fora do ar não derruba a tela', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout')) as never;

    const { modelos, verificado } = await montar('cifrada').listarModelos();

    expect(verificado).toBe(false);
    expect(modelos[0].id).toBe(MODELO_PADRAO);
  });

  it('resposta vazia cai nos recomendados em vez de num seletor sem opção', async () => {
    global.fetch = responder({ models: [] }) as never;

    const { modelos, verificado } = await montar('cifrada').listarModelos();

    expect(verificado).toBe(false);
    expect(modelos.length).toBeGreaterThan(0);
  });
});
