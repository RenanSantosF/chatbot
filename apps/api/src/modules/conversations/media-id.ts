/**
 * Tira o id da mídia de dentro do metadata pra gravar na coluna própria.
 *
 * A coluna é espelho, não substituta: o metadata continua carregando mime,
 * nome do arquivo e chave do bucket, e é de lá que este valor sai. Ter o
 * espelho num único lugar evita o defeito silencioso de um caminho de
 * criação preencher a coluna e outro não — o anexo gravado pelo caminho
 * esquecido simplesmente não abriria.
 */
export function mediaIdDe(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }
  const valor = (metadata as { mediaId?: unknown }).mediaId;
  return typeof valor === 'string' && valor ? valor : undefined;
}
