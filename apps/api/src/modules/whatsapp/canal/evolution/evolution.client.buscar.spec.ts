import { buscarMensagens } from './evolution.client';

/**
 * A busca das mensagens guardadas na Evolution.
 *
 * O formato do pedido e da resposta é o da 2.3.x (`fetchMessages`): a
 * resposta vem em `messages.records`, e a chave pode ter o telefone em
 * `remoteJidAlt` quando a conversa é endereçada por `@lid`.
 */
describe('buscar mensagens guardadas', () => {
  const credenciais = {
    baseUrl: 'https://evo.teste',
    apiKey: 'chave',
    instance: 'inst',
  };
  let fetchOriginal: typeof fetch;
  let pedido: { url: string; corpo: Record<string, unknown> } | null;

  beforeEach(() => {
    fetchOriginal = global.fetch;
    pedido = null;
    global.fetch = jest.fn((url: string, init: RequestInit) => {
      pedido = { url, corpo: JSON.parse(String(init.body)) };
      return Promise.resolve(
        new Response(
          JSON.stringify({
            messages: {
              total: 1,
              records: [{ key: { id: 'A', remoteJid: 'x@lid' } }],
            },
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it('procura o telefone em remoteJid OU remoteJidAlt', async () => {
    await buscarMensagens(credenciais, '5527996255918@s.whatsapp.net', 60);

    expect(pedido?.url).toBe('https://evo.teste/chat/findMessages/inst');
    expect(pedido?.corpo).toEqual({
      where: {
        key: {
          remoteJid: '5527996255918@s.whatsapp.net',
          remoteJidAlt: '5527996255918@s.whatsapp.net',
        },
      },
      page: 1,
      offset: 60,
    });
  });

  it('lê a lista de dentro de messages.records', async () => {
    const resposta = await buscarMensagens(
      credenciais,
      '5527996255918@s.whatsapp.net',
      60,
    );

    expect(resposta.ok).toBe(true);
    expect(resposta.dados).toHaveLength(1);
  });
});
