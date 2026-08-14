import type { MessageType } from '../../../generated/prisma/client';

/**
 * As decisões de contexto que não dependem do banco.
 *
 * Vivem separadas do AiContextBuilder por um motivo prático: são elas que
 * determinam quanto se paga por resposta e o que a IA consegue entender, e
 * são as únicas partes desse caminho que dá pra testar sem inventar meio
 * Prisma. Cada limite aqui é um número escolhido, não um palpite — o
 * comentário diz de onde veio.
 */

/** Quantas mensagens do histórico entram no contexto. */
export const LIMITE_DO_HISTORICO = 20;

/**
 * Teto por mensagem do histórico.
 *
 * Cliente colando um contrato inteiro no WhatsApp acontece, e uma mensagem
 * dessas sozinha empurra as outras dezenove pra fora da janela — a IA
 * perde o fio da conversa por causa de um anexo em texto. Cortada, ela
 * ainda dá o assunto, que é pra isso que ela está no histórico.
 */
export const LIMITE_POR_MENSAGEM = 1200;

/**
 * Teto somado dos trechos da base de conhecimento.
 *
 * Cinco trechos de 1500 caracteres são ~2 mil tokens em TODA resposta,
 * inclusive nas que não usam nenhum deles. O orçamento corta a cauda: os
 * primeiros trechos são os mais parecidos com a pergunta, então o que
 * sobra do limite é justamente o menos relevante.
 */
export const ORCAMENTO_DE_CONHECIMENTO = 4000;

/**
 * Quantos fatos do cliente vão pro prompt.
 *
 * A memória cresce sozinha a cada conversa. Sem teto, um cliente antigo
 * chega a carregar dezenas de linhas em todo turno — e as primeiras são
 * as mais antigas, que é o oposto do que interessa.
 */
export const LIMITE_DA_MEMORIA = 12;

/**
 * Mensagens que não merecem uma busca na base de conhecimento.
 *
 * Buscar custa uma chamada de embedding e enfia até quatro mil caracteres
 * no prompt. Para "oi", "ok" e "obrigado" isso é dinheiro jogado fora: não
 * existe trecho de contrato que responda "bom dia", e o que vier vai ser
 * ruído puro no meio das instruções.
 *
 * A lista é curta e literal de propósito. Errar pra menos aqui só faz uma
 * saudação carregar contexto à toa; errar pra mais faria uma pergunta de
 * verdade ser respondida sem a base — que é o defeito grave.
 */
const CORTESIAS = new Set([
  'oi',
  'ola',
  'opa',
  'eae',
  'bom dia',
  'boa tarde',
  'boa noite',
  'ok',
  'okay',
  'blz',
  'beleza',
  'certo',
  'entendi',
  'perfeito',
  'obrigado',
  'obrigada',
  'obg',
  'vlw',
  'valeu',
  'de nada',
  'tudo bem',
  'tudo bem?',
  'como vai',
  'sim',
  'nao',
  'uhum',
  'ata',
  'ah sim',
  'tá',
  'ta',
  'tá bom',
  'ta bom',
  'combinado',
  'aguardo',
  'por favor',
  'pfv',
  'boa',
  'legal',
  'show',
  'top',
]);

function simplificar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[!.,;:]+$/g, '')
    .trim();
}

/**
 * Vale gastar uma busca na base de conhecimento por esta mensagem?
 *
 * @param texto última fala do cliente
 */
export function mereceBuscaNaBase(texto: string): boolean {
  const limpo = texto.trim();
  if (!limpo) return false;

  const simples = simplificar(limpo);
  if (!simples) return false;
  if (CORTESIAS.has(simples)) return false;

  // Só emoji, só pontuação, só número solto: não há o que pesquisar.
  if (!/[a-z]/.test(simples)) return false;

  // Duas palavras ou menos e nenhuma delas com cara de assunto. "quanto
  // custa" tem duas palavras e é a pergunta mais importante que existe —
  // por isso o corte é por tamanho, não por contagem de palavras.
  if (simples.length < 4) return false;

  return true;
}

/**
 * Corta um texto sem deixar palavra pela metade.
 *
 * As reticências não são enfeite: sem elas, o modelo lê o trecho cortado
 * como se fosse a mensagem inteira e responde a uma frase que o cliente
 * não terminou de escrever.
 */
export function encurtar(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;

  const bruto = texto.slice(0, limite);
  const espaco = bruto.lastIndexOf(' ');
  const corte = espaco > limite * 0.6 ? espaco : limite;
  return `${bruto.slice(0, corte).trimEnd()}…`;
}

/**
 * Como um anexo aparece pra IA.
 *
 * Antes ele não aparecia: mídia sem legenda é gravada com conteúdo vazio,
 * e o histórico entregava um turno em branco. Da perspectiva do modelo, o
 * cliente não tinha dito nada — então ele respondia ao penúltimo assunto,
 * ou pedia pra pessoa repetir o que ela acabara de mandar.
 *
 * A IA não vê o arquivo (não mandamos o binário pro provedor), e é
 * exatamente isso que o marcador comunica: houve um anexo, e ele não pode
 * ser lido daqui.
 */
const ANEXO_POR_TIPO: Partial<Record<MessageType, string>> = {
  IMAGE: 'uma imagem',
  AUDIO: 'um áudio',
  VIDEO: 'um vídeo',
  DOCUMENT: 'um documento',
  LOCATION: 'uma localização',
};

export function descreverMensagem(mensagem: {
  content: string;
  messageType: MessageType;
  senderType: string;
}): string {
  const texto = mensagem.content?.trim() ?? '';
  const anexo = ANEXO_POR_TIPO[mensagem.messageType];

  if (!anexo) return texto;

  const quem = mensagem.senderType === 'CUSTOMER' ? 'O cliente' : 'A empresa';
  const marca = `[${quem} enviou ${anexo}, que você não consegue abrir]`;

  // Com legenda o texto é o que importa; o marcador só explica de onde ele
  // veio, pra a IA não responder "não recebi nada" a uma foto legendada.
  return texto ? `${marca} ${texto}` : marca;
}

/**
 * Junta falas seguidas do mesmo lado num turno só.
 *
 * No WhatsApp ninguém escreve um parágrafo: escreve "oi", "tudo bem?",
 * "queria saber o preço" em três mensagens. Isso chegava como três turnos
 * de usuário seguidos — o Gemini espera alternância entre user e model, e
 * cada turno extra ainda carrega o custo fixo da própria estrutura.
 *
 * Juntando, a IA lê o pedido inteiro de uma vez, que é como uma pessoa
 * leria.
 */
export function juntarTurnosSeguidos<
  T extends { role: string; content: string },
>(mensagens: T[]): T[] {
  const juntas: T[] = [];

  for (const mensagem of mensagens) {
    const anterior = juntas[juntas.length - 1];
    if (anterior && anterior.role === mensagem.role) {
      juntas[juntas.length - 1] = {
        ...anterior,
        content: `${anterior.content}\n${mensagem.content}`,
      };
      continue;
    }
    juntas.push(mensagem);
  }

  return juntas;
}

/**
 * Escolhe quantos trechos da base cabem no orçamento.
 *
 * Vêm ordenados por semelhança com a pergunta, então cortar do fim
 * descarta sempre o menos relevante. O primeiro entra mesmo se sozinho já
 * estourar o teto: devolver nenhum trecho por causa de um documento com
 * parágrafos longos seria pior que devolver um cortado.
 */
export function cabemNoOrcamento<T extends { content: string }>(
  trechos: T[],
  orcamento = ORCAMENTO_DE_CONHECIMENTO,
): T[] {
  const escolhidos: T[] = [];
  const vistos = new Set<string>();
  let gasto = 0;

  for (const trecho of trechos) {
    // A sobreposição entre pedaços faz o mesmo texto voltar em documentos
    // diferentes; pagar duas vezes por ele não ajuda em nada.
    const assinatura = trecho.content.slice(0, 120);
    if (vistos.has(assinatura)) continue;
    vistos.add(assinatura);

    if (escolhidos.length > 0 && gasto + trecho.content.length > orcamento)
      break;

    escolhidos.push(trecho);
    gasto += trecho.content.length;
  }

  return escolhidos;
}

/**
 * "sexta-feira, 14 de agosto de 2026, 15:42" no fuso da empresa.
 *
 * A IA não tem relógio. Sem isto ela respondia "amanhã", "hoje até as 18h"
 * e "ainda dá tempo" sem fazer ideia de que dia era — e um escritório que
 * atende de segunda a sexta tinha a IA marcando coisa pra domingo.
 *
 * O fuso é o da empresa, não o do servidor: o Railway roda em UTC, e três
 * horas de diferença mudam o dia inteiro perto da meia-noite.
 */
export function agoraNoFuso(fuso: string, agora = new Date()): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: fuso,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(agora);
  } catch {
    // Fuso inválido no cadastro não pode derrubar a resposta ao cliente.
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(agora);
  }
}
