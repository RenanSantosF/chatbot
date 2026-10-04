/**
 * Links dentro do texto de uma mensagem, do jeito que o WhatsApp os vê.
 *
 * O WhatsApp transforma em link não só o que começa com http, mas também
 * `www.site.com` e `site.com.br` soltos — é assim que as pessoas digitam.
 * A lista de terminações é fechada de propósito: aceitar qualquer
 * "palavra.palavra" faria "obs.:" ou "R$1.500" virarem link.
 */
const TERMINACOES =
  "com|br|net|org|io|app|dev|me|info|biz|co|gov|edu|store|shop|online|site|tech|ly|gl|link|tv|xyz|ai";

const LINK = new RegExp(
  String.raw`\b(?:https?:\/\/[^\s<>"]+|www\.[^\s<>"]+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:${TERMINACOES})(?:\.[a-z]{2})?\b(?:\/[^\s<>"]*)?)`,
  "gi",
);

/** Pontuação que costuma colar no fim do link e não faz parte dele. */
const SOBRA_NO_FIM = /[.,;:!?)\]}'"…]+$/;

export type Pedaco =
  | { tipo: "texto"; valor: string }
  | { tipo: "link"; valor: string; href: string };

function comProtocolo(link: string): string {
  return /^https?:\/\//i.test(link) ? link : `https://${link}`;
}

/** O texto em pedaços: o que é link e o que não é. */
export function separarLinks(texto: string): Pedaco[] {
  const pedacos: Pedaco[] = [];
  let ultimo = 0;
  for (const achado of texto.matchAll(LINK)) {
    const inicio = achado.index ?? 0;
    let link = achado[0];
    // Antes de um @ é e-mail ("ana@loja.com.br"), não site.
    if (texto[inicio - 1] === "@" || texto[inicio + link.length] === "@") continue;
    const sobra = SOBRA_NO_FIM.exec(link)?.[0] ?? "";
    // O ")" só sai se não fechar um "(" do próprio link (Wikipédia, por ex.).
    const aparar =
      sobra.endsWith(")") && link.includes("(") ? sobra.slice(0, -1) : sobra;
    if (aparar) link = link.slice(0, link.length - aparar.length);
    if (!link) continue;

    if (inicio > ultimo) pedacos.push({ tipo: "texto", valor: texto.slice(ultimo, inicio) });
    pedacos.push({ tipo: "link", valor: link, href: comProtocolo(link) });
    ultimo = inicio + link.length;
  }
  if (ultimo < texto.length) pedacos.push({ tipo: "texto", valor: texto.slice(ultimo) });
  return pedacos;
}

/** O primeiro link do texto — o que ganha o cartão de prévia. */
export function primeiroLink(texto: string): string | null {
  const link = separarLinks(texto).find((p) => p.tipo === "link");
  return link && link.tipo === "link" ? link.href : null;
}
