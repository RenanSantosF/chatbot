/**
 * Preço público do gemini-3.1-flash-lite — o modelo padrão da plataforma
 * (ver modelos.ts) — em dólar por token.
 *
 * É o número que sustenta o limite mensal de respostas incluído em cada
 * conta (ver AiUsageService e BillingAccount.aiMonthlyMessageLimit): o
 * limite não é um palpite, é este preço multiplicado por uma estimativa
 * de tokens por resposta, com uma margem de segurança em cima.
 *
 * Fonte: tabela pública do Google (ai.google.dev/gemini-api/docs/pricing),
 * conferida em setembro de 2026. Preço de provedor de IA muda sem aviso —
 * se um dia a conta da plataforma vier mais cara ou mais barata do que
 * este número sugere, é aqui que se atualiza.
 */
export const PRECO_ENTRADA_USD_POR_TOKEN = 0.25 / 1_000_000;
export const PRECO_SAIDA_USD_POR_TOKEN = 1.5 / 1_000_000;

/** Custo de uma chamada, em dólar. */
export function custoEmDolar(
  tokensDeEntrada: number,
  tokensDeSaida: number,
): number {
  return (
    tokensDeEntrada * PRECO_ENTRADA_USD_POR_TOKEN +
    tokensDeSaida * PRECO_SAIDA_USD_POR_TOKEN
  );
}
