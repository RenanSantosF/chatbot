import { EncryptionService } from './encryption.service';

/**
 * O cofre dos segredos de cada empresa: token do WhatsApp, app secret,
 * chave da IA. Um vazamento aqui não é "dado exposto" — é a capacidade de
 * mandar mensagem em nome da empresa pro cliente dela.
 *
 * O algoritmo é AES-GCM, que além de esconder também AUTENTICA: adulterar
 * o texto cifrado tem que dar erro, não devolver lixo silenciosamente.
 */
function comChave(chave: string) {
  const anterior = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = chave;
  const service = new EncryptionService();
  process.env.ENCRYPTION_KEY = anterior;
  return service;
}

const CHAVE_HEX = 'a'.repeat(64);

describe('ida e volta', () => {
  it('devolve exatamente o que entrou', () => {
    const service = comChave(CHAVE_HEX);
    const segredo = 'EAAG1234tokenDaMetaComCaracteres_-';

    expect(service.decrypt(service.encrypt(segredo))).toBe(segredo);
  });

  it('preserva acento e emoji', () => {
    // A mensagem de encerramento configurável passa por aqui em alguns
    // fluxos; truncar em byte estragaria o texto do cliente.
    const service = comChave(CHAVE_HEX);
    const texto = 'Configuração acentuada com emoji 🙂 e ç';

    expect(service.decrypt(service.encrypt(texto))).toBe(texto);
  });

  it('preserva texto vazio', () => {
    const service = comChave(CHAVE_HEX);
    expect(service.decrypt(service.encrypt(''))).toBe('');
  });
});

describe('o cifrado nunca se repete', () => {
  it('o mesmo segredo cifrado duas vezes dá resultados diferentes', () => {
    // IV aleatório por operação. Sem isso, dois tenants com a mesma chave
    // de IA teriam a mesma linha no banco — e quem olha o banco descobre
    // isso sem decifrar nada.
    const service = comChave(CHAVE_HEX);
    expect(service.encrypt('mesmo-segredo')).not.toBe(
      service.encrypt('mesmo-segredo'),
    );
  });

  it('o texto puro não aparece no resultado', () => {
    const service = comChave(CHAVE_HEX);
    expect(service.encrypt('token-secreto')).not.toContain('token-secreto');
  });
});

describe('adulteração', () => {
  it('recusa payload com o conteúdo trocado', () => {
    const service = comChave(CHAVE_HEX);
    const [iv, tag] = service.encrypt('token-legitimo').split('.');
    const forjado = [
      iv,
      tag,
      Buffer.from('outra-coisa').toString('base64'),
    ].join('.');

    expect(() => service.decrypt(forjado)).toThrow();
  });

  it('recusa payload com a etiqueta de autenticação trocada', () => {
    const service = comChave(CHAVE_HEX);
    const [iv, , dados] = service.encrypt('token-legitimo').split('.');
    const outraTag = Buffer.alloc(16, 7).toString('base64');

    expect(() => service.decrypt([iv, outraTag, dados].join('.'))).toThrow();
  });

  it('recusa formato quebrado com mensagem clara', () => {
    const service = comChave(CHAVE_HEX);
    expect(() => service.decrypt('sem-pontos')).toThrow(/formato inválido/i);
    expect(() => service.decrypt('')).toThrow(/formato inválido/i);
  });

  it('chave errada não decifra o segredo de quem tem a certa', () => {
    const cofre = comChave(CHAVE_HEX);
    const invasor = comChave('b'.repeat(64));

    expect(() => invasor.decrypt(cofre.encrypt('token'))).toThrow();
  });
});

describe('configuração da chave', () => {
  it('aceita chave hex de 32 bytes pronta', () => {
    const service = comChave(CHAVE_HEX);
    expect(service.decrypt(service.encrypt('ok'))).toBe('ok');
  });

  it('deriva de uma frase qualquer, pra tolerar erro de configuração', () => {
    const service = comChave('uma frase que alguém colou no painel do Railway');
    expect(service.decrypt(service.encrypt('ok'))).toBe('ok');
  });

  it('a mesma frase deriva sempre a mesma chave — senão o deploy perde tudo', () => {
    // Se a derivação não fosse determinística, cada reinicialização do
    // servidor tornaria ilegível todo token já guardado.
    const frase = 'frase-estavel';
    const cifrado = comChave(frase).encrypt('token');

    expect(comChave(frase).decrypt(cifrado)).toBe('token');
  });

  it('se recusa a subir sem chave configurada', () => {
    // Melhor não subir do que subir guardando token em texto puro.
    const anterior = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      expect(() => new EncryptionService()).toThrow(/ENCRYPTION_KEY/);
    } finally {
      process.env.ENCRYPTION_KEY = anterior;
    }
  });
});
