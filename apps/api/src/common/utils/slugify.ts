const COMBINING_DIACRITICS = /[̀-ͯ]/g;

/** Converte texto livre num identificador estável (minúsculo, sem acento, só a-z0-9-). */
export function slugify(input: string, maxLength = 60): string {
  return input
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, maxLength);
}
