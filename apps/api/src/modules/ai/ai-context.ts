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

/**
 * Quantas mensagens do histórico entram no contexto.
 *
 * Era 20. O histórico é a maior parte do custo de cada resposta — ele vai
 * inteiro, de novo, em toda mensagem —, e um atendimento de WhatsApp raramente
 * depende do que foi dito quinze mensagens atrás. Catorze mantêm o fio da
 * conversa e cortam um terço do pior caso.
 */
export const LIMITE_DO_HISTORICO = 14;

/**
 * Teto por mensagem do histórico.
 *
 * Cliente colando um contrato inteiro no WhatsApp acontece, e uma mensagem
 * dessas sozinha empurra as outras dezenove pra fora da janela — a IA
 * perde o fio da conversa por causa de um anexo em texto. Cortada, ela
 * ainda dá o assunto, que é pra isso que ela está no histórico.
 */
export const LIMITE_POR_MENSAGEM = 900;

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

/*
 * O que a EMPRESA escreve pra IA também tem teto.
 *
 * Instruções gerais e regras vão inteiras em TODA resposta — diferente
 * dos documentos, de onde só sai o trecho que responde a pergunta. Sem
 * limite, quem cadastrasse cinquenta regras de uma página cada pagaria (e
 * faria a plataforma pagar) por cinquenta páginas num "bom dia".
 *
 * Os números cabem uma operação de atendimento real com folga: 3.000
 * caracteres são uma página e meia de orientação geral, e 6.000 de regras
 * são umas trinta regras de duas linhas. O que passar disso é conteúdo de
 * consulta, e o lugar dele é um documento na base de conhecimento.
 *
 * Valem duas vezes: no cadastro (a pessoa sabe na hora — ver
 * AiInstructionsService e o DTO de configurações) e aqui na montagem, pro
 * que já estava salvo antes de os limites existirem.
 */

/** Teto das "Instruções gerais" (Configurações > IA). */
export const LIMITE_DAS_INSTRUCOES_GERAIS = 3000;

/** Teto de uma regra sozinha. */
export const LIMITE_POR_REGRA = 1000;

/** Quantas regras podem estar ativas ao mesmo tempo. */
export const LIMITE_DE_REGRAS_ATIVAS = 30;

/** Soma de assunto + texto de todas as regras ativas. */
export const ORCAMENTO_DAS_REGRAS = 6000;

/** Quanto uma regra pesa no orçamento: o que vai pro prompt. */
export function pesoDaRegra(regra: { title: string; content: string }): number {
  return regra.title.length + regra.content.length;
}

/**
 * As regras que entram no prompt, na ordem de prioridade, até o orçamento.
 *
 * A que não cabe é pulada inteira, e não cortada no meio: meia regra
 * ("nunca dê desconto acima de") ensina o contrário do que a empresa
 * escreveu. As seguintes ainda entram se couberem — uma regra comprida no
 * meio da lista não deve derrubar as curtas que vêm depois.
 */
export function regrasNoOrcamento<T extends { title: string; content: string }>(
  regras: T[],
  orcamento = ORCAMENTO_DAS_REGRAS,
  limite = LIMITE_DE_REGRAS_ATIVAS,
): { cabem: T[]; ficaramDeFora: number } {
  const cabem: T[] = [];
  let gasto = 0;
  for (const regra of regras) {
    const peso = pesoDaRegra(regra);
    if (cabem.length >= limite || gasto + peso > orcamento) continue;
    cabem.push(regra);
    gasto += peso;
  }
  return { cabem, ficaramDeFora: regras.length - cabem.length };
}

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
 * A partir de quanto tempo parado a conversa deixa de ser a mesma conversa.
 *
 * Seis horas cobre o caso comum sem ser sensível demais: alguém que
 * responde depois do almoço continua no mesmo assunto, alguém que responde
 * no dia seguinte quase nunca.
 */
const SALTO_RELEVANTE_MS = 6 * 60 * 60 * 1000;

/**
 * Avisa o modelo quando o relógio andou entre uma mensagem e a seguinte.
 *
 * O histórico chega como uma sequência lisa, sem hora nenhuma. Numa
 * conversa reaberta pelo agrupamento — o cliente volta a escrever três dias
 * depois e o sistema reaproveita a conversa antiga, de propósito, pra o
 * atendente ver o histórico — a IA lia "vou verificar e te aviso" seguido
 * de "e aí?" como se fossem dois minutos, e respondia emendando num assunto
 * encerrado. Do lado do cliente isso soa como alguém que não percebeu que a
 * semana passou.
 *
 * A marca vai como fala do próprio cliente porque é ali que a percepção de
 * tempo importa: é a mensagem DELE que chegou depois da pausa.
 */
export function marcarSaltoDeTempo(
  mensagens: { role: string; content: string; createdAt: Date }[],
): { role: string; content: string }[] {
  return mensagens.map((mensagem, indice) => {
    const anterior = mensagens[indice - 1];
    if (!anterior) return { role: mensagem.role, content: mensagem.content };

    const parada = mensagem.createdAt.getTime() - anterior.createdAt.getTime();
    if (parada < SALTO_RELEVANTE_MS) {
      return { role: mensagem.role, content: mensagem.content };
    }

    const horas = Math.round(parada / (60 * 60 * 1000));
    const quanto =
      horas >= 48
        ? `${Math.round(horas / 24)} dias`
        : horas >= 24
          ? 'mais de um dia'
          : `${horas} horas`;

    return {
      role: mensagem.role,
      content: `[depois de ${quanto} sem conversa]\n${mensagem.content}`,
    };
  });
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
