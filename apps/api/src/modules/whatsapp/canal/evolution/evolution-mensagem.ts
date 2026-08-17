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
  /**
   * O andamento do histórico, que chega FORA de `data`.
   *
   * Quando a Evolution manda um lote de conversas antigas, `data` é a
   * lista de mensagens e nada mais; o "é o último?" e o percentual sobem
   * pra raiz do evento. Procurá-los dentro de `data` faz toda importação
   * parecer eterna — nunca chega o aviso de fim.
   */
  isLatest?: boolean;
  progress?: number;
  /** A mesma coisa, na grafia que algumas versões usam. */
  progresso?: number;
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
  /** O evento de apagar traz a chave achatada com `id`, não `keyId`. */
  id?: string;
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
  /**
   * O estado de entrega, que vem de dois jeitos.
   *
   * A Evolution repassa o que o Baileys dá, e o Baileys tem o estado como
   * ENUM NUMÉRICO na origem. Dependendo da versão e do evento, o que chega
   * é o nome ("DELIVERY_ACK") ou o número (3). Declarar só `string` não
   * era só imprecisão de tipo: `traduzirStatus` chamava `.toUpperCase()`
   * no valor, e um número derrubava o webhook inteiro com TypeError — a
   * entrega voltava 500, a Evolution reenviava, e nenhum tique jamais
   * virava. O envio funcionando normalmente o tempo todo.
   */
  status?: string | number;
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
  const id = dados.key?.id ?? dados.keyId ?? dados.id;
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

/**
 * A reação a uma mensagem, quando o evento for isso.
 *
 * Reação NÃO é mensagem nova: ela modifica a mensagem reagida. Sai antes
 * da tradução porque, se caísse lá, o emoji viraria uma linha no
 * histórico — ou, do jeito que estava, seria descartado como "tipo não
 * suportado" e o cliente reagiria no vazio.
 *
 * A chave que vem aqui dentro é a da mensagem REAGIDA, não a da reação.
 * Emoji vazio significa que a pessoa desfez a reação.
 */
export function reacaoDaMensagem(
  dados: DadosDaMensagem,
): { alvo: ChaveDaMensagem; emoji: string } | null {
  const bruto = dados.message;
  if (!bruto) return null;

  const reacao = conteudo(bruto).reactionMessage as
    | { key?: { remoteJid?: string; fromMe?: boolean; id?: string }; text?: string }
    | undefined;
  if (!reacao?.key?.id || !reacao.key.remoteJid) return null;

  return {
    alvo: {
      remoteJid: reacao.key.remoteJid,
      fromMe: reacao.key.fromMe ?? false,
      id: reacao.key.id,
    },
    emoji: reacao.text ?? '',
  };
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
        /*
         * Marca de "esta mídia ainda precisa de um handle".
         *
         * Esta função é pura e não conhece a chave da mensagem, que é o
         * que a Evolution usa pra devolver o binário — o binário não fica
         * hospedado com um id, como na Meta. Quem tem a chave é o
         * controlador do webhook, e é ele que troca esta marca pelo
         * `mediaId` de verdade (ver evolution-webhook.controller).
         *
         * A marca some ali; se ela chegar ao banco, é sinal de que aquele
         * caminho não rodou — e o balão mostra o anexo como indisponível,
         * que é a verdade nesse caso.
         */
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

/**
 * O mesmo vocabulário, na forma numérica do Baileys.
 *
 * A ordem é a da biblioteca, e ela é a razão de o número existir: o estado
 * de entrega é uma escada (erro < pendente < no servidor < entregue <
 * lido), e comparar número é o que deixa o Baileys ignorar um evento
 * atrasado. Aqui a escada já existe do nosso lado (STATUS_RANK, em
 * ConversationsService) — só precisamos do nome.
 */
const STATUS_NUMERICO: Record<number, MessageStatus> = {
  0: 'FAILED',
  1: 'PENDING',
  2: 'SENT',
  3: 'DELIVERED',
  4: 'READ',
  5: 'READ',
};

/**
 * O estado de entrega, aceitando as duas formas.
 *
 * Um número chegando aqui derrubava o webhook com TypeError — e como esse
 * caminho é o de TODO tique, o efeito era o defeito mais confuso possível:
 * mensagem sai, cliente recebe, e o balão fica no relógio pra sempre.
 */
export function traduzirStatus(
  bruto: string | number | undefined | null,
): MessageStatus | null {
  if (bruto === undefined || bruto === null || bruto === '') return null;

  if (typeof bruto === 'number') return STATUS_NUMERICO[bruto] ?? null;

  // Número em forma de texto ("3") acontece: o valor atravessa JSON e
  // volta como string em algumas versões.
  const texto = String(bruto).trim();
  if (/^\d+$/.test(texto)) return STATUS_NUMERICO[Number(texto)] ?? null;

  return STATUS[texto.toUpperCase()] ?? null;
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
