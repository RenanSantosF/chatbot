/**
 * Por que a IA não respondeu, dito para quem vai atender.
 *
 * Existe porque nem toda falha da IA é a mesma falha, e a diferença é
 * acionável para o dono da empresa. Cota estourada se resolve com um
 * plano; chave errada, com uma configuração; provedor fora do ar, com
 * paciência. Um "não houve resposta automática" genérico obrigava a abrir
 * o log do servidor pra descobrir qual dos três era — e quem lê a nota no
 * painel quase nunca tem acesso a log nenhum.
 *
 * As frases descrevem O CASO, e não o desempenho do sistema. Elas aparecem
 * em "por que veio pra equipe", que é a primeira coisa que o atendente lê
 * ao abrir a conversa: começar um atendimento com um boletim de erro
 * interno não ajuda ninguém a atender.
 */

/** Normaliza pra procurar sem depender de acento nem de caixa. */
function simplificar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Sinais de que o limite acabou — de cota diária, de tokens por minuto,
 * ou de crédito.
 *
 * Vêm em formas diferentes conforme o provedor e a camada que reclama:
 * o código HTTP 429, o nome do erro da API do Google, ou o texto solto.
 * Procurar os três é o que evita cair no genérico justamente no caso mais
 * comum de uma conta nova.
 */
const SINAIS_DE_LIMITE = [
  'resource_exhausted',
  'resource exhausted',
  'quota',
  'rate limit',
  'rate_limit',
  'too many requests',
  'exceeded your current',
  'insufficient_quota',
  '429',
];

const SINAIS_DE_CREDENCIAL = [
  'api key not valid',
  'api_key_invalid',
  'permission_denied',
  'permission denied',
  'unauthenticated',
  'invalid authentication',
  '401',
  '403',
];

const SINAIS_DE_TEMPO = ['não respondeu em', 'nao respondeu em', 'timeout', 'aborted'];

export interface FalhaDaIa {
  /** A frase que vai pro painel, em "por que veio pra equipe". */
  motivo: string;
  /**
   * Vale avisar o cliente de que uma pessoa assume?
   *
   * Quase sempre sim. A exceção é a IA estar DESLIGADA de propósito: ali a
   * empresa escolheu atender só com gente, e uma mensagem automática
   * dizendo "vou chamar alguém" seria justamente o robô que ela decidiu
   * não ter.
   */
  avisarCliente: boolean;
}

/**
 * Traduz a falha técnica na frase que o atendente lê.
 *
 * @param erro o que o provedor jogou, cru
 */
export function porQueAIaNaoRespondeu(erro: unknown): FalhaDaIa {
  const texto = simplificar(
    erro instanceof Error ? `${erro.name} ${erro.message}` : String(erro),
  );
  // O mesmo texto sem separador nenhum. A mesma condição é escrita de
  // três jeitos conforme a camada que reclama — `RESOURCE_EXHAUSTED` no
  // status da API, `ResourceExhausted` no nome da classe de erro do SDK,
  // "resource exhausted" na prosa —, e procurar por cada variante viraria
  // uma lista que envelhece a cada versão do provedor.
  const compacto = texto.replace(/[^a-z0-9]/g, '');
  const bate = (sinais: string[]) =>
    sinais.some(
      (sinal) =>
        texto.includes(sinal) ||
        compacto.includes(sinal.replace(/[^a-z0-9]/g, '')),
    );

  if (bate(SINAIS_DE_LIMITE)) {
    return {
      motivo:
        'O atendimento automático atingiu o limite de uso e o cliente está esperando.',
      avisarCliente: true,
    };
  }

  if (bate(SINAIS_DE_CREDENCIAL)) {
    return {
      motivo:
        'O atendimento automático está com a chave de acesso recusada e o cliente está esperando.',
      avisarCliente: true,
    };
  }

  if (bate(SINAIS_DE_TEMPO)) {
    return {
      motivo:
        'O atendimento automático demorou demais para responder e o cliente está esperando.',
      avisarCliente: true,
    };
  }

  return {
    motivo: 'O cliente escreveu e não houve resposta automática.',
    avisarCliente: true,
  };
}

/**
 * O que o cliente ouve quando a IA não conseguiu responder.
 *
 * Não menciona a IA nem o defeito: pro cliente, o que existe é uma empresa
 * que demorou. Falar em "erro no sistema" transformaria um problema nosso
 * numa preocupação dele — e a frase precisa ser verdadeira, o que ela é,
 * porque este caminho sempre vem com transferência para uma pessoa.
 */
export const AVISO_DE_INDISPONIBILIDADE =
  'Só um instante — vou chamar alguém da equipe para continuar seu atendimento por aqui.';
