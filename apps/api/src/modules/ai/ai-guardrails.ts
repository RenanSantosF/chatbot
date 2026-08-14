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
): VerificacaoDaResposta {
  const jaTransferiu = ferramentas.includes('transferToQueue');
  const urgenciaNoPedido = bate(doCliente, SINAIS_DE_URGENCIA);

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
