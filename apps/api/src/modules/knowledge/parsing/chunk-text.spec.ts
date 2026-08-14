import { chunkText } from './chunk-text';

/**
 * Como o documento vira pedaços buscáveis.
 *
 * O tamanho do pedaço decide a qualidade da busca inteira: grande demais e
 * o embedding vira uma média borrada de assuntos diferentes — a mesma
 * resposta volta pra qualquer pergunta; pequeno demais e o trecho chega na
 * IA sem contexto suficiente pra significar alguma coisa.
 */

const TAMANHO_ALVO = 1500;
// A sobreposição é acrescentada DEPOIS do corte, então o pedaço final pode
// passar do alvo por ela — é o preço combinado de não perder a frase que
// cai bem na fronteira.
const TETO = TAMANHO_ALVO + 200 + 2;
const texto = (n: number, letra = 'a') => letra.repeat(n);

describe('corte por parágrafo', () => {
  it('mantém parágrafos curtos juntos, em vez de picar o documento à toa', () => {
    const entrada = ['Primeiro parágrafo.', 'Segundo parágrafo.'].join('\n\n');
    expect(chunkText(entrada)).toEqual([
      'Primeiro parágrafo.\n\nSegundo parágrafo.',
    ]);
  });

  it('abre pedaço novo quando o parágrafo seguinte estouraria o alvo', () => {
    const pedacos = chunkText([texto(1200), texto(800)].join('\n\n'));
    expect(pedacos.length).toBeGreaterThan(1);
  });

  it('deixa sobreposição entre pedaços, pra frase relevante não morrer na fronteira', () => {
    const pedacos = chunkText([texto(1200, 'a'), texto(800, 'b')].join('\n\n'));
    // O começo do segundo pedaço repete o fim do primeiro.
    expect(pedacos[1].startsWith('a')).toBe(true);
    expect(pedacos[1]).toContain('b');
  });

  it('descarta sobra pequena demais pra significar alguma coisa', () => {
    expect(chunkText('ok')).toEqual([]);
  });

  it('texto vazio não vira pedaço nenhum', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('\n\n   \n\n')).toEqual([]);
  });
});

describe('parágrafo gigante sem linha em branco', () => {
  /**
   * O caso real: PDF de contrato exportado, ou texto colado de uma página.
   * Não há linha em branco em lugar nenhum, então o documento inteiro é UM
   * parágrafo — e sem partir, ele virava UM chunk. O embedding resultante é
   * a média do documento todo, e a busca passa a devolver esse mesmo bloco
   * pra qualquer pergunta.
   */
  it('é partido em vez de virar um bloco só', () => {
    const pedacos = chunkText(texto(10_000));

    expect(pedacos.length).toBeGreaterThan(1);
    for (const pedaco of pedacos) {
      expect(pedaco.length).toBeLessThanOrEqual(TETO);
    }
  });

  it('não parte palavra no meio quando há espaço por perto', () => {
    const palavra = 'contratante ';
    const pedacos = chunkText(palavra.repeat(400));

    for (const pedaco of pedacos) {
      // Nenhum pedaço começa ou termina com um caco de palavra.
      expect(pedaco.startsWith('contratante')).toBe(true);
      expect(pedaco.endsWith('contratante')).toBe(true);
    }
  });

  it('não perde conteúdo do meio do documento', () => {
    const marcador = 'CLAUSULA-DECIMA-SEGUNDA';
    const entrada = `${texto(4000)} ${marcador} ${texto(4000)}`;

    expect(chunkText(entrada).join(' ')).toContain(marcador);
  });

  it('termina — não fica em laço com texto sem espaço nenhum', () => {
    // Um `while` que não avança aqui trava o processamento do upload
    // inteiro, e o dono só vê o documento preso em "processando".
    const pedacos = chunkText(texto(20_000, 'x'));
    expect(pedacos.length).toBeGreaterThan(10);
  });
});
