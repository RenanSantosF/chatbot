// Mede propriedades computadas de elementos na tela rodando.
//
// Existe porque "está fino?" / "a borda mudou?" não se responde olhando um
// print: já aconteceu de eu medir o elemento errado e afirmar que estava
// certo. Aqui o número vem do próprio navegador.
//
// Uso:  node scripts/measure.mjs <token> <rota> '<seletor>' [prop1,prop2]
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const [, , token, route = '/dashboard/inbox', seletor, props = ''] = process.argv;
const BASE = process.env.PREVIEW_BASE || 'http://127.0.0.1:3000';

if (!token || !seletor) {
  console.error("Uso: node scripts/measure.mjs <token> <rota> '<seletor>' [props]");
  process.exit(1);
}

async function loadChromium() {
  try {
    return (await import('playwright-core')).chromium;
  } catch {
    const cache = process.env.PREVIEW_CACHE || '/tmp/preview-tools';
    return createRequire(path.join(cache, 'index.js'))('playwright-core').chromium;
  }
}

const chromium = await loadChromium();
const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const dir = readdirSync(root).find((name) => name.startsWith('chromium-'));
const executablePath = path.join(root, dir, 'chrome-linux', 'chrome');

const browser = await chromium.launch({
  executablePath,
  args: ['--no-sandbox', '--no-proxy-server'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([
  { name: 'access_token', value: token, domain: '127.0.0.1', path: '/' },
]);
const page = await context.newPage();
await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

const resultado = await page.evaluate(
  ({ seletor, props }) => {
    const els = [...document.querySelectorAll(seletor)];
    return els.slice(0, 5).map((el) => {
      const cs = getComputedStyle(el);
      const saida = {
        tag: el.tagName.toLowerCase(),
        classe: String(el.className).slice(0, 60),
        // Diferença entre largura total e área útil = espessura da barra.
        larguraDaBarra: el.offsetWidth - el.clientWidth,
        alturaDaBarra: el.offsetHeight - el.clientHeight,
        rolavel: el.scrollHeight > el.clientHeight,
      };
      for (const p of props.split(',').filter(Boolean)) saida[p] = cs.getPropertyValue(p);
      return saida;
    });
  },
  { seletor, props },
);

console.log(JSON.stringify(resultado, null, 2));
await browser.close();
