import type { MessageStatus, MessageType } from '../../../../../generated/prisma/client';
import type { ChaveDaMensagem } from './evolution-id';

/**
 * Tradução do vocabulário da Evolution pro nosso.
 *
 * Isto é função pura de propósito. O webhook da Evolution é a peça que
 * mais vai mudar debaixo dos nossos pés — é software livre em movimento,
 * e a forma do evento já mudou entre versões maiores. Deixar a tradução
 * separada do controlador significa que uma mudança dessas se conserta com
 * teste, e não abrindo um servidor de verdade pra ver o que chega.
 *
 * O formato vem do Baileys, que é o que a Evolution embrulha: cada tipo de
 * mensagem é uma CHAVE diferente dentro de `message`, e não um campo
 * `type` como na Meta. Descobrir o tipo é achar qual chave veio.
 */

export interface EventoDaEvolution {
  event?: string;
  instance?: string;
  data?: DadosDaMensagem | DadosDaMensagem[] | Record<string, unknown>;
}

export interface DadosDaMensagem {
  key?: {
    remoteJid?: string;
    /**
     * O JID de verdade, quando `remoteJid` vem como `@lid`.
     *
     * O WhatsApp passou a esconder o telefone atrás de um identificador
     * opaco em algumas conversas. A Evolution já troca um pelo outro
     * quando consegue, mas nem sempre consegue — e sem olhar aqui, essas
     * mensagens seriam descartadas como se fossem de grupo.
     */
    remoteJidAlt?: string;
    fromMe?: boolean;
    id?: string;
  };
  /**
   * A chave achatada do evento de status.
   *
   * `messages.update` NÃO manda `key` — manda `keyId`, `remoteJid` e
   * `fromMe` soltos na raiz. Formatos diferentes pro mesmo conceito no
   * mesmo webhook, e é o tipo de detalhe que só aparece em produção: o
   * envio funciona, e o tique de entregue nunca vira.
   */
  keyId?: string;
  remoteJid?: string;
  fromMe?: boolean;
  pushName?: string;
  messageTimestamp?: number | string;
  message?: Record<string, unknown> | null;
  /**
   * A citação, no lugar onde a Evolution realmente a deixa.
   *
   * Ela reescreve `extendedTextMessage` como `conversation` antes de
   * mandar, e o contexto — que inclui o id da mensagem citada — sobe pra
   * raiz do evento. Procurar só dentro da mensagem perde toda resposta.
   */
  contextInfo?: { stanzaId?: string } | null;
  status?: string;
}

/**
 * A chave da mensagem, venha ela como vier.
 *
 * Os dois formatos existem de verdade no mesmo webhook: `messages.upsert`
 * manda `key` aninhada, `messages.update` manda os campos soltos. Aceitar
 * os dois num lugar só evita que a próxima mudança de formato precise ser
 * caçada em dois arquivos.
 */
export function chaveDoEvento(dados: DadosDaMensagem): ChaveDaMensagem | null {
  const id = dados.key?.id ?? dados.keyId;
  const bruto = dados.key?.remoteJid ?? dados.remoteJid;
  if (!id || !bruto) return null;

  // `@lid` é o identificador opaco que o WhatsApp usa pra esconder o
  // telefone. Quando ele vem, o número de verdade está no campo ao lado.
  const remoteJid = bruto.includes('@lid') ? (dados.key?.remoteJidAlt ?? bruto) : bruto;

  return { remoteJid, fromMe: dados.key?.fromMe ?? dados.fromMe ?? false, id };
}

export interface MensagemTraduzida {
  content: string;
  messageType: MessageType;
  metadata?: Record<string, unknown>;
  /** O id da mensagem citada, quando é resposta a outra. */
  citando?: string;
}

/** O que a Evolution chama de mídia, e o que isso vira aqui. */
const MIDIAS: Record<string, MessageType> = {
  imageMessage: 'IMAGE',
  videoMessage: 'VIDEO',
  audioMessage: 'AUDIO',
  documentMessage: 'DOCUMENT',
  stickerMessage: 'IMAGE',
};

interface ConteudoDeMidia {
  mimetype?: string;
  caption?: string;
  fileName?: string;
  ptt?: boolean;
}

interface ContextoDaCitacao {
  contextInfo?: { stanzaId?: string };
}

/**
 * O texto de uma mensagem, onde quer que ele esteja.
 *
 * São três lugares diferentes pra mesma coisa: `conversation` é o texto
 * simples, `extendedTextMessage` é o texto que veio com citação ou
 * prévia de link, e `ephemeralMessage` embrulha qualquer um dos dois
 * quando a conversa está com mensagens temporárias ligadas. Perder o
 * terceiro caso faria mensagem de cliente sumir sem erro nenhum — e só
 * nas conversas com mensagem temporária, que é o tipo de defeito que
 * ninguém reproduz.
 */
function conteudo(message: Record<string, unknown>): Record<string, unknown> {
  const efemera = message.ephemeralMessage as { message?: Record<string, unknown> } | undefined;
  if (efemera?.message) return conteudo(efemera.message);

  const vista = message.viewOnceMessage as { message?: Record<string, unknown> } | undefined;
  if (vista?.message) return conteudo(vista.message);

  return message;
}

export function traduzirMensagem(
  dados: DadosDaMensagem,
): MensagemTraduzida | null {
  const bruto = dados.message;
  if (!bruto) return null;

  const message = conteudo(bruto);
  // A Evolution reescreve `extendedTextMessage` como `conversation` e sobe
  // o contexto pra raiz do evento. O texto continua chegando; a citação só
  // chega se for procurada aqui.
  const citadoNaRaiz = dados.contextInfo?.stanzaId;

  const texto =
    (message.conversation as string | undefined) ??
    (message.extendedTextMessage as { text?: string } | undefined)?.text;
  if (texto) {
    return {
      content: texto,
      messageType: 'TEXT',
      citando: citacao(message.extendedTextMessage as ContextoDaCitacao) ?? citadoNaRaiz,
    };
  }

  const localizacao = message.locationMessage as
    | { degreesLatitude?: number; degreesLongitude?: number; name?: string; address?: string }
    | undefined;
  if (localizacao) {
    const rotulo = [localizacao.name, localizacao.address].filter(Boolean).join(' — ');
    return {
      content:
        rotulo ||
        `Localização: ${localizacao.degreesLatitude}, ${localizacao.degreesLongitude}`,
      messageType: 'LOCATION',
      metadata: {
        latitude: localizacao.degreesLatitude,
        longitude: localizacao.degreesLongitude,
        name: localizacao.name,
        address: localizacao.address,
      },
    };
  }

  const contato = message.contactMessage as { displayName?: string } | undefined;
  if (contato) {
    return {
      content: contato.displayName
        ? `Contato compartilhado: ${contato.displayName}`
        : 'Contato compartilhado',
      messageType: 'OTHER',
    };
  }

  for (const [chave, tipo] of Object.entries(MIDIAS)) {
    const midia = message[chave] as ConteudoDeMidia | undefined;
    if (!midia) continue;

    return {
      // Mesma regra do caminho oficial: a legenda vira o texto da
      // mensagem, e sem legenda fica o nome do arquivo — que é o que quem
      // atende precisa ver na lista sem abrir a conversa.
      content: midia.caption ?? midia.fileName ?? '',
      messageType: tipo,
      metadata: {
        mimeType: midia.mimetype,
        fileName: midia.fileName,
        // `ptt` (push to talk) é o áudio gravado na hora, e não um arquivo
        // de música anexado. A tela mostra os dois diferente.
        voice: midia.ptt ?? false,
        // Sem `mediaId`: na Evolution o binário não fica hospedado com um
        // id como na Meta, ele é buscado pela chave da mensagem. Enquanto
        // o download não existir, o balão mostra o nome do arquivo e diz
        // que o anexo não está disponível — o que é a verdade.
        evolutionPendente: true,
      },
      citando: citacao(midia as unknown as ContextoDaCitacao) ?? citadoNaRaiz,
    };
  }

  return null;
}

function citacao(parte: ContextoDaCitacao | undefined): string | undefined {
  return parte?.contextInfo?.stanzaId ?? undefined;
}

/** Vocabulário de status da Evolution -> o nosso. O que não estiver aqui é ignorado. */
const STATUS: Record<string, MessageStatus | undefined> = {
  PENDING: 'PENDING',
  SERVER_ACK: 'SENT',
  DELIVERY_ACK: 'DELIVERED',
  READ: 'READ',
  PLAYED: 'READ',
  ERROR: 'FAILED',
};

export function traduzirStatus(bruto: string | undefined): MessageStatus | null {
  if (!bruto) return null;
  return STATUS[bruto.toUpperCase()] ?? null;
}

/**
 * A hora em que a mensagem foi escrita, e não a hora em que chegou aqui.
 *
 * Importa porque a Evolution entrega em lote depois de uma queda de
 * sessão: sem isto, uma conversa parada há horas apareceria inteira como
 * se tivesse acontecido no instante da reconexão, e o alarme de espera
 * mostraria zero minuto pra quem esperou a manhã toda.
 */
export function horaDaMensagem(dados: DadosDaMensagem): Date | undefined {
  const bruto = Number(dados.messageTimestamp ?? 0);
  if (!bruto) return undefined;
  const data = new Date(bruto * 1000);
  return Number.isNaN(data.getTime()) ? undefined : data;
}

/** O evento traz uma mensagem só ou uma lista, dependendo da versão. */
export function comoLista(data: EventoDaEvolution['data']): DadosDaMensagem[] {
  if (!data) return [];
  return (Array.isArray(data) ? data : [data]) as DadosDaMensagem[];
}
