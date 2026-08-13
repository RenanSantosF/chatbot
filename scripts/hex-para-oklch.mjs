// sRGB -> OKLCH. Escrito à mão porque estimar "no olho" já me fez errar:
// o L do OKLCH não é a claridade percebida que eu supunha.
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function hexToOklch(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255));

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const C = Math.hypot(A, B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;

  return `oklch(${L.toFixed(4)} ${C.toFixed(4)} ${H.toFixed(1)})`;
}

const cores = {
  'fundo (#0B141A)': '#0B141A',
  'superfície (#111B21)': '#111B21',
  'cartão/entrada (#202C33)': '#202C33',
  'elevado (#233138)': '#233138',
  'texto (#E9EDEF)': '#E9EDEF',
  'texto fraco (#8696A0)': '#8696A0',
  'verde primário (#00A884)': '#00A884',
  'verde hover (#06CF9C)': '#06CF9C',
  'verde vivo (#25D366)': '#25D366',
  'balão enviado (#005C4B)': '#005C4B',
  'verde pílula (#103529)': '#103529',
};
for (const [nome, hex] of Object.entries(cores)) console.log(nome.padEnd(28), hexToOklch(hex));
