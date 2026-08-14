/**
 * Travas de segurança da IA.
 *
 * O problema real observado em produção não foi a IA se recusar a
 * transferir: foi ela ESCREVER "vou transferir você agora" e nunca chamar
 * a ferramenta. O cliente lê uma promessa, o painel continua marcando
 * "aguardando cliente", e ninguém assume. Prompt não resolve isso — o
 * modelo já era instruído a chamar a ferramenta e mesmo assim falhou.
 *
 * A abordagem aqui é outra: em vez de tentar impedir a promessa, o sistema
 * a torna verdadeira. Se o texto promete gente, a conversa vai pra gente,
 * tenha a ferramenta sido chamada ou não.
 */

import { fatosSemLastro } from './ai-fatos';

/**
 * O que vai no lugar da resposta que afirmava um dado inventado.
 *
 * Não pede desculpa nem expõe que houve uma trava: pro cliente isso seria
 * ruído sobre um problema que é nosso. Diz o que vai acontecer — e é
 * verdade, porque esta trava sempre vem com transferência.
 */
const RESPOSTA_SEM_LASTRO =
  'Essa informação eu prefiro confirmar com a equipe pra não te passar nada errado. ' +
  'Já estou chamando alguém pra continuar seu atendimento por aqui.';

/** Normaliza pra comparar sem acento e sem caixa. */
function simplificar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Frases em que a IA se compromete a passar pra um humano ou a voltar
 * depois. Toda uma família de erro: "já vou te transferir", "um advogado
 * vai assumir", "vou verificar e te retorno".
 */
const PROMESSAS_DE_HUMANO = [
  'vou transferir',
  'vou encaminhar',
  'estou transferindo',
  'estou encaminhando',
  'vou passar (o|seu|sua)',
  'sera transferid',
  'sera encaminhad',
  'ja te encaminhei',
  'ja transferi',
  'um (advogado|profissional|especialista|atendente|colega)',
  '(advogado|profissional|especialista|atendente) (vai|ira|entrara)',
  'nossa equipe (vai|ira)',
  'aguarde um (instante|momento|pouco)',
  'assumir (esta|essa) conversa',
];

/**
 * Promessa de retorno futuro. A IA não tem como cumprir: ela não roda
 * sozinha depois nem tem agenda. Quem cumpre é uma pessoa — então também
 * vira handoff.
 */
const PROMESSAS_DE_RETORNO = [
  'vou verificar',
  'vou checar',
  'vou consultar',
  'te retorno',
  'retorno (em|para|ja|assim)',
  'darei um retorno',
  'te aviso',
  'entro em contato',
  'volto (em|com|assim)',
];

/**
 * Anúncios de que o atendimento acabou.
 *
 * Observado em produção: o cliente disse "Ok", a IA respondeu "Atendimento
 * encerrado por aqui. Se precisar de mais alguma coisa, é só mandar
 * mensagem" — e a conversa continuou marcada como "aguardando cliente" no
 * painel. O cliente leu que tinha acabado; o painel achava que estava em
 * andamento. Os dois lados discordando sobre o fato mais básico do
 * atendimento.
 *
 * Mesmo remédio das promessas de humano: em vez de proibir a frase, o
 * sistema a cumpre. Se a IA disse que encerrou, encerra.
 */
const ANUNCIOS_DE_ENCERRAMENTO = [
  'atendimento encerrado',
  'atendimento (foi )?(finalizado|concluido)',
  'conversa encerrada',
  '(vou|estou) (encerrar|encerrando|finalizar|finalizando)',
  'encerrando (o|seu|nosso) atendimento',
  'finalizo (o|seu) atendimento',
  'por aqui (entao|então)? ?encerr',
];

/**
 * Sinais de urgência real na fala do CLIENTE. Não é análise de sentimento
 * — é uma lista curta de situações em que atrasar tem custo alto, e por
 * isso vale forçar prioridade mesmo se a IA não classificou.
 */
const SINAIS_DE_URGENCIA = [
  'estou preso',
  'fui preso',
  'to preso',
  'na delegacia',
  'flagrante',
  'audiencia (hoje|amanha)',
  'prazo (vence|vencendo|termina) hoje',
  'emergencia',
  'urgente',
  'acidente',
  'no hospital',
  'ameaca',
  'despejo',
  'penhora',
  'intimacao',
];

function bate(texto: string, padroes: string[]): boolean {
  const alvo = simplificar(texto);
  return padroes.some((padrao) => new RegExp(padrao).test(alvo));
}

export interface VerificacaoDaResposta {
  /** A conversa precisa ir pra um humano mesmo sem a IA ter pedido. */
  precisaHandoff: boolean;
  /** Prioridade mínima que a conversa deve ter. */
  prioridadeMinima?: 'HIGH' | 'URGENT';
  /** Explicação curta pro painel — quem assume precisa saber por quê. */
  motivo?: string;
  /**
   * A IA avisou o cliente de que o atendimento acabou. O sistema encerra
   * de verdade, pra o painel dizer o mesmo que o cliente leu.
   */
  encerrar?: boolean;
  /**
   * Texto que substitui a resposta antes de ela sair.
   *
   * Só a trava de fato inventado usa isto, e usa porque é o único caso em
   * que o problema está NO TEXTO: as outras travas corrigem o mundo pra
   * bater com o que foi dito, esta impede que o que foi dito chegue ao
   * cliente. Um endereço errado já causou o estrago no instante em que foi
   * lido — não dá pra consertar depois.
   */
  substituirPor?: string;
}

/**
 * Confere a resposta da IA contra o que ela de fato fez.
 *
 * @param resposta   texto que a IA vai mandar pro cliente
 * @param doCliente  última mensagem do cliente
 * @param ferramentas nomes das ferramentas que a IA realmente executou
 */
export function verificarResposta(
  resposta: string,
  doCliente: string,
  ferramentas: string[],
  fontes = '',
): VerificacaoDaResposta {
  const jaTransferiu = ferramentas.includes('transferToQueue');
  const urgenciaNoPedido = bate(doCliente, SINAIS_DE_URGENCIA);

  /*
   * Fato inventado vem primeiro, e é a única trava que barra o texto.
   *
   * As outras corrigem o mundo depois: a IA prometeu uma pessoa, o sistema
   * chama a pessoa, e a frase que o cliente leu passa a ser verdade. Com
   * um endereço errado não existe esse conserto — o cliente já anotou.
   * Então esta age antes, e o preço é o certo a pagar: um atendimento a
   * mais na fila da equipe em vez de um cliente indo ao lugar errado.
   */
  const inventados = fatosSemLastro(resposta, fontes);
  if (inventados.length > 0) {
    const tipos = [...new Set(inventados.map((fato) => fato.tipo))].join(', ');
    return {
      precisaHandoff: true,
      prioridadeMinima: 'HIGH',
      substituirPor: RESPOSTA_SEM_LASTRO,
      motivo: `O cliente pediu um dado (${tipos}) que não está na base de conhecimento.`,
    };
  }

  /*
   * Os motivos abaixo descrevem O CASO, não o desempenho da IA.
   *
   * Antes diziam coisas como "a IA não escalou sozinha" e "ela não tem como
   * cumprir isso". Essa nota aparece no painel em "por que veio pra equipe",
   * e é a primeira coisa que quem vai atender lê. Abrir um atendimento com
   * um boletim de falha do próprio sistema não ajuda ninguém a atender — e
   * numa demonstração pra cliente, deprecia o produto sem necessidade.
   *
   * O que o atendente precisa saber é o que está em jogo e por que a
   * conversa chegou nele. É isso que estas frases dizem agora.
   */
  if (urgenciaNoPedido && !jaTransferiu) {
    return {
      precisaHandoff: true,
      prioridadeMinima: 'URGENT',
      motivo: 'O cliente relatou uma situação urgente.',
    };
  }

  if (!jaTransferiu && bate(resposta, PROMESSAS_DE_HUMANO)) {
    return {
      precisaHandoff: true,
      prioridadeMinima: 'HIGH',
      motivo: 'O cliente foi avisado de que alguém da equipe assumiria daqui.',
    };
  }

  if (!jaTransferiu && bate(resposta, PROMESSAS_DE_RETORNO)) {
    return {
      precisaHandoff: true,
      motivo: 'Foi prometido um retorno ao cliente.',
    };
  }

  // Depois das promessas de humano, de propósito: se a IA disse que
  // encerrou E que alguém assumiria, quem manda é a segunda. Encerrar uma
  // conversa que espera atendente a tiraria da fila justamente quando
  // alguém precisa pegá-la.
  if (bate(resposta, ANUNCIOS_DE_ENCERRAMENTO)) {
    return {
      precisaHandoff: false,
      encerrar: true,
      motivo: 'O cliente foi avisado de que o atendimento estava encerrado.',
    };
  }

  // Urgência sem promessa nenhuma: pelo menos sobe a prioridade, mesmo que
  // a IA tenha resolvido responder direto.
  if (urgenciaNoPedido) {
    return {
      precisaHandoff: false,
      prioridadeMinima: 'URGENT',
      motivo: 'Situação urgente relatada pelo cliente.',
    };
  }

  return { precisaHandoff: false };
}
