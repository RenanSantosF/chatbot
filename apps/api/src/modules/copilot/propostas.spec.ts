import { acharPorNome, criarToken, lerToken } from './propostas';

describe('achar pelo nome', () => {
  const equipe = [
    { nome: 'Ana Paula' },
    { nome: 'Ana Clara' },
    { nome: 'João Pedro' },
  ];

  it('acha sem acento e sem caixa', () => {
    expect(acharPorNome(equipe, 'joao')).toEqual({
      achado: { nome: 'João Pedro' },
    });
  });

  it('dois candidatos: pergunta qual, em vez de chutar', () => {
    const resultado = acharPorNome(equipe, 'ana');
    expect('erro' in resultado && resultado.erro).toMatch(
      /Mais de um.*Ana Paula, Ana Clara/,
    );
  });

  it('uma letra só não "contém" meio mundo', () => {
    expect('erro' in acharPorNome(equipe, 'o')).toBe(true);
  });
});

describe('token de proposta', () => {
  const antes = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'segredo-de-teste';
  });
  afterAll(() => {
    process.env.JWT_SECRET = antes;
  });
  const quem = { tenantId: 't1', userId: 'u1' };
  const acao = { tipo: 'etiqueta' as const, nome: 'VIP' };

  it('volta a ação intacta pra mesma pessoa', () => {
    expect(lerToken(criarToken(acao, quem), quem)).toEqual({ acao });
  });

  it('recusa token adulterado', () => {
    const [corpo, assinatura] = criarToken(acao, quem).split('.');
    const outro = Buffer.from(
      JSON.stringify({
        t: 't1',
        u: 'u1',
        e: Date.now() + 1e6,
        a: { tipo: 'etiqueta', nome: 'Outra' },
      }),
    ).toString('base64url');
    expect(lerToken(`${outro}.${assinatura}`, quem)).toEqual({
      erro: 'Proposta inválida.',
    });
    expect(corpo).toBeTruthy();
  });

  it('recusa proposta de outra empresa', () => {
    expect(
      lerToken(criarToken(acao, quem), { tenantId: 't2', userId: 'u1' }),
    ).toEqual({ erro: 'Esta proposta não é sua.' });
  });

  it('expira em meia hora', () => {
    const token = criarToken(acao, quem, 0);
    expect(lerToken(token, quem, 31 * 60 * 1000)).toMatchObject({
      erro: expect.stringMatching(/expirou/) as string,
    });
  });
});
