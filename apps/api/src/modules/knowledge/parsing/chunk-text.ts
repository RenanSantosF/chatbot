const TARGET_CHUNK_SIZE = 1500;
const OVERLAP_SIZE = 200;
const MIN_CHUNK_SIZE = 20;

/**
 * Divide texto longo em pedaços de tamanho razoável pra embedding — grande
 * demais e a busca perde precisão (o embedding vira uma média borrada de
 * assuntos diferentes); pequeno demais e perde contexto. Tenta respeitar
 * parágrafos como unidade natural de corte, com uma pequena sobreposição
 * entre pedaços pra não cortar uma frase relevante bem na fronteira.
 */
/**
 * Parte um parágrafo que sozinho já passa do tamanho alvo.
 *
 * Sem isto, um arquivo sem linha em branco — PDF exportado de contrato,
 * texto colado de uma página — virava UM chunk gigante: o embedding
 * resultante é a média borrada do documento inteiro, e a busca semântica
 * passa a devolver esse mesmo bloco pra qualquer pergunta. Corta em espaço
 * quando há um por perto, pra não partir palavra no meio.
 */
function partirLongo(paragraph: string): string[] {
  if (paragraph.length <= TARGET_CHUNK_SIZE) return [paragraph];

  const pedacos: string[] = [];
  let resto = paragraph;

  while (resto.length > TARGET_CHUNK_SIZE) {
    const janela = resto.slice(0, TARGET_CHUNK_SIZE);
    const espaco = janela.lastIndexOf(' ');
    const corte = espaco > TARGET_CHUNK_SIZE / 2 ? espaco : TARGET_CHUNK_SIZE;
    pedacos.push(resto.slice(0, corte).trim());
    // A sobreposição vale aqui pelo mesmo motivo que entre parágrafos: uma
    // frase relevante não pode morrer exatamente na fronteira do corte.
    resto = resto.slice(Math.max(corte - OVERLAP_SIZE, 0)).trim();
  }

  if (resto) pedacos.push(resto);
  return pedacos.filter(Boolean);
}

/**
 * O rabinho do pedaço anterior que abre o próximo.
 *
 * Corta na palavra inteira mais próxima: um pedaço que começa com "atante
 * pagará" entrega ao embedding um caco que não é português, e a busca fica
 * pior justamente na fronteira que a sobreposição existia pra proteger.
 */
function sobreposicaoDe(chunk: string): string {
  const cauda = chunk.slice(-OVERLAP_SIZE);
  const espaco = cauda.indexOf(' ');
  return espaco >= 0 ? cauda.slice(espaco + 1) : cauda;
}

export function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap(partirLongo);

  if (paragraphs.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length <= TARGET_CHUNK_SIZE || !current) {
      current = candidate;
      continue;
    }

    chunks.push(current);
    current = `${sobreposicaoDe(current)}\n\n${paragraph}`;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.filter((chunk) => chunk.length >= MIN_CHUNK_SIZE);
}
