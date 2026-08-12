// Tira prints das telas com o Chromium que já vem no ambiente.
//
// Uso:  node scripts/capture.mjs <token> [rota] [pasta-destino]
// Sem rota, percorre as telas principais nos dois temas.
//
// Chamado pelo dev-preview.sh, mas funciona sozinho se a aplicação já
// estiver de pé.
import { readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const token = process.argv[2];
const route = process.argv[3] || '';
const outDir = process.argv[4] || '/tmp/shots';
const BASE = process.env.PREVIEW_BASE || 'http://127.0.0.1:3000';

if (!token) {
  console.error('Falta o token de acesso. Uso: node scripts/capture.mjs <token> [rota] [pasta]');
  process.exit(1);
}

/**
 * O playwright-core não é dependência da aplicação — é ferramenta de
 * inspeção, instalada fora do workspace. Como o import de um módulo ESM
 * resolve a partir do arquivo (e não do diretório atual), procuramos
 * também na pasta de cache usada pelo dev-preview.sh.
 */
async function loadChromium() {
  try {
    return (await import('playwright-core')).chromium;
  } catch {
    /* segue para o cache */
  }
  const cache = process.env.PREVIEW_CACHE || '/tmp/preview-tools';
  try {
    return createRequire(path.join(cache, 'index.js'))('playwright-core').chromium;
  } catch {
    return null;
  }
}

const chromium = await loadChromium();
if (!chromium) {
  console.error(
    'playwright-core não encontrado. Rode o scripts/dev-preview.sh (ele instala) ou:\n' +
      '  mkdir -p /tmp/preview-tools && cd /tmp/preview-tools && npm i --no-save playwright-core',
  );
  process.exit(1);
}

/**
 * O navegador já está baixado, mas o número da build muda a cada
 * atualização da imagem — por isso procuramos em vez de fixar o caminho.
 */
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const dir = readdirSync(root)
    .filter((name) => name.startsWith('chromium-'))
    .sort()
    .pop();
  if (!dir) throw new Error(`Nenhum Chromium em ${root}`);
  return path.join(root, dir, 'chrome-linux', 'chrome');
}

const ROUTES = [
  ['/dashboard/inbox', 'inbox'],
  ['/dashboard', 'overview'],
  ['/dashboard/customers', 'customers'],
  ['/dashboard/knowledge', 'knowledge'],
  ['/dashboard/profile', 'profile'],
  ['/dashboard/settings', 'settings'],
  ['/dashboard/settings/ai', 'settings-ai'],
  ['/dashboard/settings/whatsapp', 'settings-whatsapp'],
  ['/dashboard/settings/inbox', 'settings-inbox'],
  ['/dashboard/settings/team', 'settings-team'],
  ['/dashboard/settings/collection', 'settings-collection'],
];

const targets = route ? [[route, 'shot']] : ROUTES;
const themes = route ? ['light'] : ['light', 'dark'];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  // --no-proxy-server: o proxy do ambiente é herdado por variável de
  // ambiente e faz o Chromium não alcançar o próprio localhost.
  args: ['--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage', '--disable-gpu'],
  executablePath: findChromium(),
});

let failures = 0;

for (const theme of themes) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme,
  });
  // Cookie sem esquema e sem porta; o domínio precisa bater com a URL,
  // então usamos 127.0.0.1 em todo lugar (com 'localhost' não cola).
  const host = new URL(BASE).hostname;
  await ctx.addCookies([{ name: 'access_token', value: token, domain: host, path: '/' }]);
  await ctx.addInitScript(`try { localStorage.setItem('theme', '${theme}') } catch {}`);

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

  for (const [routePath, name] of targets) {
    const file = path.join(outDir, themes.length > 1 ? `${name}-${theme}.png` : `${name}.png`);
    errors.length = 0;
    try {
      // 'networkidle' nunca resolve aqui: o socket.io mantém a conexão
      // aberta o tempo todo. Esperamos o DOM e damos um tempo pro fetch.
      const res = await page.goto(BASE + routePath, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: file, fullPage: false });
      const status = res?.status() ?? 0;
      if (status >= 400) failures++;
      console.log(`${status} ${theme.padEnd(5)} ${routePath} -> ${file}`);
      for (const err of errors) console.log(`      erro de página: ${err}`);
    } catch (err) {
      failures++;
      console.log(`ERRO  ${theme.padEnd(5)} ${routePath}: ${String(err).slice(0, 200)}`);
    }
  }

  await ctx.close();
}

await browser.close();
process.exit(failures ? 1 : 0);
