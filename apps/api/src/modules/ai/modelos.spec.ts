import { MODELO_PADRAO, ordenarModelos, rotuloDoModelo } from './modelos';

/**
 * A ordem do seletor de modelo.
 *
 * Ela existe porque a lista vem do Google em ordem de API, e uma lista de
 * trinta linhas nessa ordem é tão inútil quanto o campo de texto livre que
 * ela substituiu: quem abre a tela quer as opções que fazem sentido pra
 * atendimento, não um inventário da conta.
 */
describe('ordem dos modelos', () => {
  it('os recomendados vêm primeiro, na ordem do produto', () => {
    const ordenados = ordenarModelos([
      'gemini-9.9-pro',
      'gemini-3.5-flash',
      'gemini-1.0-pro',
      MODELO_PADRAO,
    ]);

    expect(ordenados[0].id).toBe(MODELO_PADRAO);
    expect(ordenados[1].id).toBe('gemini-3.5-flash');
  });

  it('o resto vem depois, em ordem alfabética', () => {
    const ordenados = ordenarModelos([
      'gemini-zz-pro',
      'gemini-aa-pro',
      MODELO_PADRAO,
    ]);

    expect(ordenados.map((m) => m.id)).toEqual([
      MODELO_PADRAO,
      'gemini-aa-pro',
      'gemini-zz-pro',
    ]);
  });

  it('marca quais são recomendados, pra a tela poder destacar', () => {
    const [primeiro, segundo] = ordenarModelos([
      MODELO_PADRAO,
      'gemini-1.0-pro',
    ]);

    expect(primeiro.recomendado).toBe(true);
    expect(segundo.recomendado).toBe(false);
  });

  it('não repete um modelo que veio duas vezes', () => {
    // A API do Google pagina; juntar páginas pode duplicar.
    expect(ordenarModelos([MODELO_PADRAO, MODELO_PADRAO])).toHaveLength(1);
  });

  it('um modelo desconhecido não some da lista', () => {
    // O seletor precisa conseguir mostrar o que a empresa já gravou, mesmo
    // que o produto não recomende — senão ela abre a tela e vê outro
    // selecionado, achando que era esse que estava valendo.
    expect(ordenarModelos(['gemini-inventado']).map((m) => m.id)).toEqual([
      'gemini-inventado',
    ]);
  });
});

describe('rótulo do modelo', () => {
  it('transforma o id em nome legível', () => {
    expect(rotuloDoModelo('gemini-3.1-flash-lite')).toBe(
      'Gemini 3.1 Flash Lite',
    );
  });

  it('não mexe em pedaço que começa com número', () => {
    expect(rotuloDoModelo('gemini-2.5-pro')).toBe('Gemini 2.5 Pro');
  });
});
