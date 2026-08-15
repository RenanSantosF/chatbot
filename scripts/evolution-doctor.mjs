#!/usr/bin/env node
/**
 * Confere a corrente inteira antes de você abrir a tela de conectar.
 *
 * Conectar o WhatsApp pela Evolution depende de TRÊS coisas ao mesmo
 * tempo, e quando falha o sintoma é sempre o mesmo — "conectou mas não
 * chega mensagem" — não importa qual das três quebrou. Este script separa
 * uma da outra:
 *
 *   1. o servidor Evolution está de pé e a chave da API é aceita;
 *   2. a API do Inteliwa é alcançável DA INTERNET (não do seu computador);
 *   3. o endereço do webhook responde a quem bate nele.
 *
 * Uso:
 *   node scripts/evolution-doctor.mjs \
 *     --evolution https://evo.exemplo.com \
 *     --chave SUA_API_KEY \
 *     --api https://sua-api.up.railway.app
 */

const TEMPO_LIMITE_MS = 15_000;

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const evolution = argumento('evolution')?.replace(/\/+$/, '');
const chave = argumento('chave');
const api = argumento('api')?.replace(/\/+$/, '');

if (!evolution || !chave || !api) {
  console.error(
    'Uso: node scripts/evolution-doctor.mjs --evolution <url> --chave <apikey> --api <url-da-api>',
  );
  process.exit(2);
}

let problemas = 0;

function ok(texto) {
  console.log(`  \x1b[32mok\x1b[0m   ${texto}`);
}
function falha(texto, comoResolver) {
  problemas += 1;
  console.log(`  \x1b[31mfalha\x1b[0m ${texto}`);
  if (comoResolver) console.log(`       \x1b[2m→ ${comoResolver}\x1b[0m`);
}
function aviso(texto) {
  console.log(`  \x1b[33maviso\x1b[0m ${texto}`);
}

async function pegar(url, opcoes = {}) {
  try {
    const resposta = await fetch(url, {
      ...opcoes,
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    return { resposta, corpo: await resposta.text() };
  } catch (erro) {
    // O `cause` é onde mora o motivo de verdade: "fetch failed" sozinho
    // não distingue DNS que não resolveu de servidor no chão.
    const causa = erro?.cause?.code ?? erro?.cause?.message ?? erro?.message;
    return { erro: String(causa) };
  }
}

console.log(`\n1. Servidor Evolution — ${evolution}`);

const raiz = await pegar(`${evolution}/`);
if (raiz.erro) {
  falha(
    `não respondeu (${raiz.erro})`,
    'confira se o contêiner está de pé e se o endereço tem https:// e o domínio certo',
  );
} else {
  ok(`respondeu (HTTP ${raiz.resposta.status})`);
  if (!evolution.startsWith('https://')) {
    aviso(
      'o endereço não é https — a chave da API viaja em cabeçalho e, em HTTP puro, vai em texto limpo',
    );
  }
}

const instancias = await pegar(`${evolution}/instance/fetchInstances`, {
  headers: { apikey: chave },
});
if (instancias.erro) {
  falha(`não deu pra listar as sessões (${instancias.erro})`);
} else if (instancias.resposta.status === 401 || instancias.resposta.status === 403) {
  falha(
    'a chave da API foi recusada',
    'é a AUTHENTICATION_API_KEY do docker-compose — cole exatamente a mesma na tela',
  );
} else if (!instancias.resposta.ok) {
  falha(`resposta inesperada (HTTP ${instancias.resposta.status}): ${instancias.corpo.slice(0, 200)}`);
} else {
  let lista = [];
  try {
    const json = JSON.parse(instancias.corpo);
    lista = Array.isArray(json) ? json : (json?.instances ?? []);
  } catch {
    /* Lista ilegível não é motivo pra parar: a chave já foi aceita. */
  }
  ok(`chave aceita — ${lista.length} sessão(ões) no servidor`);
  for (const item of lista) {
    const nome = item?.name ?? item?.instance?.instanceName ?? '?';
    const estado = item?.connectionStatus ?? item?.instance?.state ?? '?';
    console.log(`       ${nome}: ${estado}`);
  }
}

console.log(`\n2. API do Inteliwa — ${api}`);

const raizApi = await pegar(`${api}/api`);
if (raizApi.erro) {
  falha(
    `não respondeu (${raizApi.erro})`,
    'a Evolution precisa alcançar este endereço pela internet; localhost não serve, use um túnel em desenvolvimento',
  );
} else {
  ok(`respondeu (HTTP ${raizApi.resposta.status})`);
}

// O webhook exige segredo de 48 caracteres hexadecimais. Batendo com um
// segredo inválido, a resposta CERTA é 403: prova que a rota existe, está
// publicada e recusa quem não deveria entrar.
const webhook = await pegar(`${api}/api/webhooks/evolution/${'0'.repeat(48)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ event: 'teste' }),
});
if (webhook.erro) {
  falha(`o endereço do webhook não respondeu (${webhook.erro})`);
} else if (webhook.resposta.status === 403) {
  ok('o webhook está publicado e recusou um segredo inválido, como deveria');
} else if (webhook.resposta.status === 404) {
  falha(
    'o webhook não existe neste endereço (404)',
    'a API publicada é mais antiga que o provedor Evolution — faça o deploy da main',
  );
} else {
  aviso(
    `o webhook respondeu HTTP ${webhook.resposta.status} a um segredo inválido; era esperado 403`,
  );
}

console.log(
  problemas === 0
    ? '\n\x1b[32mTudo pronto.\x1b[0m Abra Configurações > WhatsApp e conecte lendo o QR code.\n'
    : `\n\x1b[31m${problemas} problema(s).\x1b[0m Resolva antes de tentar conectar — o sintoma na tela é o mesmo pros três.\n`,
);
process.exit(problemas === 0 ? 0 : 1);
