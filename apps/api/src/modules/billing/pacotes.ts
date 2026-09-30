/**
 * Os pacotes avulsos de respostas de IA à venda.
 *
 * Vêm da variável `STRIPE_PACOTES`, no formato `quantidade:price_id`
 * separados por vírgula — ex.: `1000:price_a,3000:price_b,10000:price_c`.
 * Assim criar, tirar ou mudar o preço de um pacote é mexer no Stripe e numa
 * variável, sem deploy. O preço em si nunca mora aqui: quem cobra é o
 * Stripe, e a tela mostra o valor que ele devolve.
 *
 * Compatível com a configuração antiga: `STRIPE_TOPUP_PRICE_ID` sozinha
 * continua valendo como o pacote de 1.000.
 */

export interface PacoteConfigurado {
  quantidade: number;
  precoId: string;
}

/** Quantas respostas o pacote antigo (de variável única) sempre creditou. */
export const QUANTIDADE_DO_PACOTE_ANTIGO = 1000;

/** Teto de sanidade: um pacote não credita mais que isso (erro de digitação na variável). */
const MAXIMO_POR_PACOTE = 1_000_000;

export function pacotesConfigurados(
  env: Record<string, string | undefined> = process.env,
): PacoteConfigurado[] {
  const pacotes = new Map<number, string>();

  for (const item of (env.STRIPE_PACOTES ?? '').split(',')) {
    const [quantidadeBruta, precoId] = item
      .split(':')
      .map((parte) => parte.trim());
    const quantidade = Number(quantidadeBruta);
    if (
      !precoId?.startsWith('price_') ||
      !Number.isInteger(quantidade) ||
      quantidade <= 0 ||
      quantidade > MAXIMO_POR_PACOTE
    ) {
      continue;
    }
    pacotes.set(quantidade, precoId);
  }

  const antigo = env.STRIPE_TOPUP_PRICE_ID?.trim();
  if (antigo && !pacotes.has(QUANTIDADE_DO_PACOTE_ANTIGO)) {
    pacotes.set(QUANTIDADE_DO_PACOTE_ANTIGO, antigo);
  }

  return [...pacotes.entries()]
    .map(([quantidade, precoId]) => ({ quantidade, precoId }))
    .sort((a, b) => a.quantidade - b.quantidade);
}

/**
 * Quantas respostas creditar por um pagamento avulso confirmado.
 *
 * Lê o que o próprio checkout gravou (`metadata.pacote`). Não confere com a
 * lista atual de propósito: se um pacote saiu da variável depois de pago,
 * quem pagou recebe mesmo assim. Sessão sem a marca (anterior aos pacotes
 * variados) credita o pacote antigo.
 */
export function quantidadePaga(
  metadata: Record<string, string> | null | undefined,
): number {
  const quantidade = Number(metadata?.pacote);
  return Number.isInteger(quantidade) &&
    quantidade > 0 &&
    quantidade <= MAXIMO_POR_PACOTE
    ? quantidade
    : QUANTIDADE_DO_PACOTE_ANTIGO;
}
