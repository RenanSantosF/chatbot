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
export function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

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
    const overlap = current.slice(-OVERLAP_SIZE);
    current = `${overlap}\n\n${paragraph}`;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.filter((chunk) => chunk.length >= MIN_CHUNK_SIZE);
}
