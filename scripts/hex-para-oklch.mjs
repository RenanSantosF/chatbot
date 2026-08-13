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

// --- caminho inverso: OKLCH -> hex, pra conferir o que uma escolha vira na tela.
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function oklchToHex(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);

  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;

  const rgb = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255));

  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Contraste WCAG entre duas cores OKLCH, pra checar legibilidade de texto. */
export function contraste(a, b) {
  const lum = ([L, C, H]) => {
    const hex = oklchToHex(L, C, H);
    const n = parseInt(hex.slice(1), 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
