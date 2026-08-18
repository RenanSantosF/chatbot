/**
 * Quais modelos do Gemini o produto oferece.
 *
 * POR QUE ISTO NÃO É UMA LISTA FIXA E PRONTO
 *
 * O campo de modelo era texto livre, e o texto livre tem um defeito
 * conhecido: quem não sabe o nome exato digita errado e descobre pelo
 * silêncio — a IA simplesmente para de responder, e a mensagem do Google
 * ("model is not found") só aparece pra quem lê log de servidor.
 *
 * Trocar por uma lista fixa no código resolve isso e cria outro problema:
 * o Google lança e aposenta modelo o tempo todo, e a lista passa a mentir
 * no dia seguinte ao deploy. Foi por isso que o campo nasceu livre.
 *
 * A saída é perguntar ao próprio Google: a chave que a empresa já
 * configurou permite listar os modelos que ELA pode usar, e essa lista
 * nunca está desatualizada. Estes daqui só definem a ORDEM — o que
 * aparece primeiro na hora de escolher — e servem de rede quando a
 * consulta não é possível (sem chave configurada, ou o Google fora do ar).
 */

/**
 * O modelo de uma conta nova.
 *
 * Flash Lite é o mais barato da família e o mais rápido, e atendimento é
 * exatamente o caso de uso que isso atende: perguntas curtas, respostas
 * curtas, muitas por dia. Quem precisar de mais troca na tela.
 */
export const MODELO_PADRAO = 'gemini-3.1-flash-lite';

/**
 * A ordem de preferência do produto.
 *
 * Não é a lista completa nem pretende ser: é o topo do seletor. Tudo o
 * mais que a chave da empresa puder usar aparece depois, em ordem
 * alfabética.
 */
export const MODELOS_PREFERIDOS = [
  MODELO_PADRAO,
  'gemini-3.1-flash',
  'gemini-3.5-flash',
] as const;

export interface ModeloDisponivel {
  id: string;
  rotulo: string;
  /** Está entre os que o produto recomenda? A tela destaca esses. */
  recomendado: boolean;
}

/**
 * Nome bonito a partir do id, pra quando o Google não mandar um.
 *
 * "gemini-3.1-flash-lite" vira "Gemini 3.1 Flash Lite".
 */
export function rotuloDoModelo(id: string): string {
  return id
    .split('-')
    .map((parte) =>
      /^\d/.test(parte) ? parte : parte.charAt(0).toUpperCase() + parte.slice(1),
    )
    .join(' ');
}

/**
 * Põe os recomendados na frente, o resto em ordem alfabética.
 *
 * Um seletor com trinta linhas em ordem de API é tão inútil quanto o campo
 * de texto que ele substitui: quem abre a tela quer as três opções que
 * fazem sentido pra atendimento, não um inventário.
 */
export function ordenarModelos(ids: string[]): ModeloDisponivel[] {
  const preferidos = MODELOS_PREFERIDOS as readonly string[];
  const posicao = (id: string) => {
    const i = preferidos.indexOf(id);
    return i === -1 ? preferidos.length : i;
  };

  return [...new Set(ids)]
    .sort((a, b) => posicao(a) - posicao(b) || a.localeCompare(b))
    .map((id) => ({
      id,
      rotulo: rotuloDoModelo(id),
      recomendado: preferidos.includes(id),
    }));
}
