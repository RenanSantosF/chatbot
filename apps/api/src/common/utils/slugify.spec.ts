import { slugify } from './slugify';

/**
 * A chave estável de setores, regras de direcionamento e campos de coleta.
 *
 * Ela vai parar em dois lugares que não perdoam: no enum que a IA recebe
 * (uma chave com acento ou espaço faz o modelo devolver outra coisa) e na
 * URL. Por isso o resultado tem que ser sempre a-z, 0-9 e hífen — nunca
 * "vazio" por acidente, que viraria uma chave em branco no banco.
 */
describe('slugify', () => {
  it('tira acento e caixa', () => {
    expect(slugify('Financeiro')).toBe('financeiro');
    expect(slugify('Jurídico')).toBe('juridico');
    expect(slugify('Ação Trabalhista')).toBe('acao-trabalhista');
    expect(slugify('Cobrança e Renegociação')).toBe('cobranca-e-renegociacao');
  });

  it('junta separadores repetidos num hífen só', () => {
    expect(slugify('Suporte   Técnico')).toBe('suporte-tecnico');
    expect(slugify('Vendas / Pré-venda')).toBe('vendas-pre-venda');
  });

  it('não deixa hífen sobrando nas pontas', () => {
    expect(slugify('  Financeiro  ')).toBe('financeiro');
    expect(slugify('--Financeiro--')).toBe('financeiro');
    expect(slugify('!!! Urgente !!!')).toBe('urgente');
  });

  it('mantém número, que aparece em nome de setor', () => {
    expect(slugify('Equipe 2 - Plantão')).toBe('equipe-2-plantao');
  });

  it('devolve vazio quando não sobra nada aproveitável', () => {
    // Quem chama trata isso com um padrão ("fila", "regra", "campo") — ver
    // QueuesService.uniqueKey. O importante é não devolver "-" nem lixo.
    expect(slugify('!!!')).toBe('');
    expect(slugify('   ')).toBe('');
    expect(slugify('🙂')).toBe('');
  });

  it('corta no limite pra não estourar a coluna', () => {
    expect(slugify('a'.repeat(200))).toHaveLength(60);
    expect(slugify('a'.repeat(200), 10)).toHaveLength(10);
  });

  it('o resultado só tem o que a IA e a URL aceitam', () => {
    const entradas = [
      'Ação Trabalhista',
      'Suporte / Nível 2',
      'Cobrança — 2ª via',
      'çãõéü',
    ];

    for (const entrada of entradas) {
      expect(slugify(entrada)).toMatch(/^[a-z0-9-]*$/);
    }
  });
});
