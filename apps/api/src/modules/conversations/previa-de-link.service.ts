import { Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface PreviaDeLink {
  url: string;
  titulo: string | null;
  descricao: string | null;
  imagem: string | null;
  site: string | null;
}

/** Prévia achada vale uma semana; "não achei" vale um dia. */
const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;
const VALIDADE_DA_AUSENCIA_MS = 24 * 60 * 60 * 1000;
const TEMPO_LIMITE_MS = 6_000;
/** O que interessa está no <head>; não há por que baixar a página inteira. */
const BYTES_MAXIMOS = 512 * 1024;
const REDIRECIONAMENTOS_MAXIMOS = 4;

/**
 * Endereço que não pode ser buscado por nós.
 *
 * A prévia é o servidor da API abrindo um link que um CLIENTE mandou —
 * qualquer pessoa no WhatsApp escolhe o endereço. Sem esta trava, um
 * `http://169.254.169.254/...` ou `http://localhost:3001/...` faria a API
 * ler a rede interna do Railway e devolver o conteúdo como "título".
 */
export function enderecoInterno(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return enderecoInterno(v6.slice(7));
  return (
    v6 === '::' ||
    v6 === '::1' ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    v6.startsWith('fe80')
  );
}

async function urlPermitida(url: URL): Promise<boolean> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.internal')) return false;
  if (isIP(host)) return !enderecoInterno(host);
  try {
    const enderecos = await lookup(host, { all: true });
    return (
      enderecos.length > 0 &&
      enderecos.every((e) => !enderecoInterno(e.address))
    );
  } catch {
    return false;
  }
}

const ENTIDADES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
};

function decodificar(texto: string): string {
  return texto
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&([a-z]+);/gi, (inteira, nome: string) =>
      nome.toLowerCase() in ENTIDADES ? ENTIDADES[nome.toLowerCase()] : inteira,
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** As tags <meta> da página, por nome/propriedade, em minúsculas. */
function metas(html: string): Map<string, string> {
  const achadas = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const atributo = (nome: string) =>
      new RegExp(`\\b${nome}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
        .exec(tag)
        ?.slice(2)
        .find((v) => v !== undefined);
    const chave = (atributo('property') ?? atributo('name'))?.toLowerCase();
    const valor = atributo('content');
    if (chave && valor && !achadas.has(chave)) {
      achadas.set(chave, decodificar(valor));
    }
  }
  return achadas;
}

/** Título, descrição e imagem a partir do HTML — Open Graph primeiro. */
export function lerPrevia(
  html: string,
  urlFinal: string,
): Omit<PreviaDeLink, 'url'> {
  const m = metas(html);
  const tituloDaPagina = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const titulo =
    m.get('og:title') ??
    m.get('twitter:title') ??
    (tituloDaPagina ? decodificar(tituloDaPagina) : undefined);
  const descricao =
    m.get('og:description') ??
    m.get('twitter:description') ??
    m.get('description');
  const imagemBruta =
    m.get('og:image:secure_url') ?? m.get('og:image') ?? m.get('twitter:image');

  let imagem: string | null = null;
  if (imagemBruta) {
    try {
      const resolvida = new URL(imagemBruta, urlFinal);
      // Só https: o painel é https, e imagem http seria bloqueada pelo
      // navegador como conteúdo misto.
      if (resolvida.protocol === 'http:') resolvida.protocol = 'https:';
      if (resolvida.protocol === 'https:') imagem = resolvida.toString();
    } catch {
      imagem = null;
    }
  }

  const corta = (texto: string | undefined, maximo: number) =>
    texto ? texto.slice(0, maximo) : null;
  return {
    titulo: corta(titulo, 200),
    descricao: corta(descricao, 300),
    imagem: imagem && imagem.length <= 1000 ? imagem : null,
    site:
      corta(m.get('og:site_name'), 100) ??
      new URL(urlFinal).hostname.replace(/^www\./, ''),
  };
}

/**
 * A prévia dos links que aparecem nas conversas.
 *
 * O WhatsApp mostra título e imagem do site; o painel mostrava o endereço
 * cru, sem nem ser clicável. A busca é feita aqui, no servidor, porque o
 * navegador não pode ler outro site (CORS) — e guardada, porque o mesmo
 * link aparece em várias conversas e é aberto várias vezes.
 */
@Injectable()
export class PreviaDeLinkService {
  private readonly logger = new Logger(PreviaDeLinkService.name);
  private readonly emAndamento = new Map<string, Promise<PreviaDeLink>>();

  constructor(private readonly prisma: PrismaService) {}

  async buscar(endereco: string): Promise<PreviaDeLink | null> {
    let url: URL;
    try {
      url = new URL(
        /^https?:\/\//i.test(endereco) ? endereco : `https://${endereco}`,
      );
    } catch {
      return null;
    }
    if (url.toString().length > 2000) return null;
    url.hash = '';
    const chave = url.toString();

    const guardada = await this.prisma.client.previaDeLink.findUnique({
      where: { url: chave },
    });
    if (guardada) {
      const idade = Date.now() - guardada.buscadaEm.getTime();
      const validade = guardada.titulo ? VALIDADE_MS : VALIDADE_DA_AUSENCIA_MS;
      if (idade < validade) return guardada.titulo ? guardada : null;
    }

    let busca = this.emAndamento.get(chave);
    if (!busca) {
      busca = this.baixar(url).finally(() => this.emAndamento.delete(chave));
      this.emAndamento.set(chave, busca);
    }
    const previa = await busca;
    return previa.titulo ? previa : null;
  }

  private async baixar(url: URL): Promise<PreviaDeLink> {
    const chave = url.toString();
    let dados: Omit<PreviaDeLink, 'url'> = {
      titulo: null,
      descricao: null,
      imagem: null,
      site: null,
    };
    try {
      const pagina = await this.pagina(url);
      if (pagina) dados = lerPrevia(pagina.html, pagina.url);
    } catch (erro) {
      this.logger.debug(`Sem prévia para ${chave}: ${String(erro)}`);
    }

    await this.prisma.client.previaDeLink
      .upsert({
        where: { url: chave },
        create: { url: chave, ...dados },
        update: { ...dados, buscadaEm: new Date() },
      })
      .catch(() => undefined);
    return { url: chave, ...dados };
  }

  /** O HTML, seguindo redirecionamentos um a um — cada destino conferido. */
  private async pagina(
    inicio: URL,
  ): Promise<{ html: string; url: string } | null> {
    let atual = inicio;
    for (let salto = 0; salto <= REDIRECIONAMENTOS_MAXIMOS; salto += 1) {
      if (!(await urlPermitida(atual))) return null;

      const resposta = await fetch(atual, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; BellisLinkPreview/1.0; +https://usebellis.com.br)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
        },
      });

      if (resposta.status >= 300 && resposta.status < 400) {
        const destino = resposta.headers.get('location');
        await resposta.body?.cancel();
        if (!destino) return null;
        atual = new URL(destino, atual);
        continue;
      }
      if (!resposta.ok) {
        await resposta.body?.cancel();
        return null;
      }
      const tipo = resposta.headers.get('content-type') ?? '';
      if (!/text\/html|application\/xhtml/i.test(tipo)) {
        await resposta.body?.cancel();
        return null;
      }

      const html = await lerAte(resposta, BYTES_MAXIMOS, tipo);
      return { html, url: atual.toString() };
    }
    return null;
  }
}

async function lerAte(
  resposta: Response,
  maximo: number,
  tipo: string,
): Promise<string> {
  const leitor = resposta.body?.getReader();
  if (!leitor) return '';
  const pedacos: Uint8Array[] = [];
  let total = 0;
  while (total < maximo) {
    const { done, value } = await leitor.read();
    if (done || !value) break;
    pedacos.push(value);
    total += value.length;
  }
  await leitor.cancel().catch(() => undefined);
  const charset = /charset=([\w-]+)/i.exec(tipo)?.[1]?.toLowerCase();
  const decodificador = new TextDecoder(
    charset === 'iso-8859-1' ||
      charset === 'latin1' ||
      charset === 'windows-1252'
      ? 'latin1'
      : 'utf-8',
  );
  return decodificador.decode(Buffer.concat(pedacos));
}
