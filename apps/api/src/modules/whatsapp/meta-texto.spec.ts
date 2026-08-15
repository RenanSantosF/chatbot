import { detalharErroDeRede, extrairWamid } from './meta-texto';

/**
 * "fetch failed" é um beco sem saída.
 *
 * O caso real: uma mensagem de cliente não saiu, e a única pista no log era
 * `ERROR [WhatsappSenderService] Falha ao enviar mensagem via WhatsApp:
 * fetch failed`. Essa string é tudo que a exceção do `fetch` mostra por
 * fora, e ela é idêntica pra DNS que não resolveu, conexão derrubada no
 * meio, TLS recusado e tempo esgotado — quatro problemas com quatro
 * soluções diferentes.
 *
 * O motivo de verdade fica em `cause`, e às vezes mais de um nível abaixo.
 */
describe('detalhando o erro de rede', () => {
  it('desenterra o motivo escondido no cause', () => {
    const erro = new Error('fetch failed', {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND graph.facebook.com'), {
        code: 'ENOTFOUND',
      }),
    });

    expect(detalharErroDeRede(erro)).toBe(
      'fetch failed <- getaddrinfo ENOTFOUND graph.facebook.com (ENOTFOUND)',
    );
  });

  it('segue a corrente por mais de um nível', () => {
    const raiz = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const meio = new Error('socket hang up', { cause: raiz });
    const erro = new Error('fetch failed', { cause: meio });

    expect(detalharErroDeRede(erro)).toContain('ECONNRESET');
  });

  it('erro sem cause continua legível', () => {
    expect(detalharErroDeRede(new Error('deu ruim'))).toBe('deu ruim');
  });

  it('o que não é Error não quebra o log', () => {
    expect(detalharErroDeRede('string solta')).toBe('string solta');
  });

  it('não entra em laço se o cause apontar pra si mesmo', () => {
    // Acontece com wrappers mal escritos, e um laço aqui derrubaria o
    // processo dentro de um catch — o pior lugar possível.
    const erro: Error & { cause?: unknown } = new Error('circular');
    erro.cause = erro;

    expect(() => detalharErroDeRede(erro)).not.toThrow();
  });
});

describe('lendo o id da mensagem', () => {
  it('acha o wamid na resposta da Meta', () => {
    const corpo = JSON.stringify({ messages: [{ id: 'wamid.ABC' }] });
    expect(extrairWamid(corpo)).toBe('wamid.ABC');
  });

  it('resposta sem mensagem não vira id inventado', () => {
    expect(extrairWamid(JSON.stringify({ messages: [] }))).toBeNull();
  });

  it('resposta que não é JSON não derruba o envio', () => {
    expect(extrairWamid('<html>502</html>')).toBeNull();
  });
});
