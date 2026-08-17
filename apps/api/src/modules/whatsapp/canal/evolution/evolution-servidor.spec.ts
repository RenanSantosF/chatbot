import { normalizarEndereco, servidorDaPlataforma } from './evolution-servidor';

/**
 * De quem é o servidor de mensagens.
 *
 * A resposta mudou, e não por gosto de tela: a chave da Evolution é
 * GLOBAL — quem a tem cria, lê e apaga QUALQUER sessão do servidor. Pedi-la
 * a cada empresa, como a tela fazia, entregava a cada cliente o poder de
 * derrubar o WhatsApp de todos os outros. Estes testes guardam o lugar
 * onde ela passou a morar: o ambiente da API, e só ele.
 */

describe('o servidor da plataforma', () => {
  const antes = { ...process.env };
  afterEach(() => {
    process.env = { ...antes };
  });

  it('vem do ambiente da API', () => {
    process.env.EVOLUTION_BASE_URL = 'https://evo.exemplo.com';
    process.env.EVOLUTION_API_KEY = 'segredo';

    expect(servidorDaPlataforma()).toEqual({
      baseUrl: 'https://evo.exemplo.com',
      apiKey: 'segredo',
    });
  });

  it('é nulo quando falta qualquer uma das duas', () => {
    // Meia configuração é pior que nenhuma: com endereço e sem chave, a
    // conexão só falharia lá na frente, com erro de credencial recusada.
    process.env.EVOLUTION_BASE_URL = 'https://evo.exemplo.com';
    delete process.env.EVOLUTION_API_KEY;
    expect(servidorDaPlataforma()).toBeNull();

    delete process.env.EVOLUTION_BASE_URL;
    process.env.EVOLUTION_API_KEY = 'segredo';
    expect(servidorDaPlataforma()).toBeNull();
  });

  it('é nulo quando as variáveis existem vazias', () => {
    // Variável declarada e sem valor é o estado normal de um painel de
    // hospedagem recém-configurado.
    process.env.EVOLUTION_BASE_URL = '   ';
    process.env.EVOLUTION_API_KEY = '';

    expect(servidorDaPlataforma()).toBeNull();
  });
});

describe('o endereço, escrito de qualquer jeito', () => {
  it.each([
    ['devoted-insight-production.up.railway.app', 'https://devoted-insight-production.up.railway.app'],
    ['https://evo.exemplo.com/', 'https://evo.exemplo.com'],
    ['https://evo.exemplo.com///', 'https://evo.exemplo.com'],
    ['http://localhost:8080', 'http://localhost:8080'],
  ])('%s vira %s', (bruto, esperado) => {
    // Os dois erros de sempre, agora cometidos por nós e não pelo cliente:
    // o painel de hospedagem mostra o domínio pelado, e a barra do fim
    // sobra ao copiar. Sem esquema não é endereço; com barra dupla,
    // algumas rotas respondem 404 sem explicar nada.
    expect(normalizarEndereco(bruto)).toBe(esperado);
  });

  it('não transforma http em https — servidor local não tem certificado', () => {
    expect(normalizarEndereco('http://192.168.0.10:8080')).toBe(
      'http://192.168.0.10:8080',
    );
  });
});
