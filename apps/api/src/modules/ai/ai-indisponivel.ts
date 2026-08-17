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
 * De que TIPO foi a falha, sem ainda dizer nada a ninguém.
 *
 * Separado da frase porque o mesmo erro precisa ser dito de dois jeitos
 * diferentes conforme quem lê: o atendente que abre uma conversa parada
 * (ver `porQueAIaNaoRespondeu`) e o operador que perguntou algo ao
 * assistente do painel (ver CopilotService). O que não pode é cada um
 * manter a própria lista de sinais — elas envelhecem a cada versão do
 * provedor, e uma envelheceria sem a outra.
 */
export type TipoDeFalhaDaIa =
  | 'limite'
  | 'credencial'
  | 'tempo'
  | 'desconhecida';

export function classificarFalhaDaIa(erro: unknown): TipoDeFalhaDaIa {
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

  if (bate(SINAIS_DE_LIMITE)) return 'limite';
  if (bate(SINAIS_DE_CREDENCIAL)) return 'credencial';
  if (bate(SINAIS_DE_TEMPO)) return 'tempo';
  return 'desconhecida';
}

/**
 * Traduz a falha técnica na frase que o atendente lê.
 *
 * @param erro o que o provedor jogou, cru
 */
export function porQueAIaNaoRespondeu(erro: unknown): FalhaDaIa {
  const motivo: Record<TipoDeFalhaDaIa, string> = {
    limite:
      'O atendimento automático atingiu o limite de uso e o cliente está esperando.',
    credencial:
      'O atendimento automático está com a chave de acesso recusada e o cliente está esperando.',
    tempo:
      'O atendimento automático demorou demais para responder e o cliente está esperando.',
    desconhecida: 'O cliente escreveu e não houve resposta automática.',
  };

  return { motivo: motivo[classificarFalhaDaIa(erro)], avisarCliente: true };
}

/**
 * A mesma falha, dita pra quem OPERA o painel.
 *
 * Outro leitor, outra frase. O atendente lê "o cliente está esperando",
 * que é a informação útil pra ele. Quem perguntou algo ao assistente
 * precisa de outra coisa: o que aconteceu e onde se resolve — senão o
 * caminho é o que este defeito produzia, um "erro do servidor" que manda
 * o dono da empresa abrir log de API pra descobrir que a cota acabou.
 */
export function porQueOCopilotoFalhou(erro: unknown): string {
  switch (classificarFalhaDaIa(erro)) {
    case 'limite':
      return 'A chave de IA desta empresa atingiu o limite de uso. Isso costuma liberar sozinho depois de alguns minutos; se for constante, é caso de aumentar o plano no provedor.';
    case 'credencial':
      return 'A chave de IA foi recusada pelo provedor. Confira em Configurações > IA se ela ainda é válida.';
    case 'tempo':
      return 'O provedor de IA demorou demais para responder. Tente de novo em alguns instantes.';
    default:
      return 'Não consegui responder agora — a IA falhou nesta chamada. Tente de novo; se continuar, o motivo exato está no log da API.';
  }
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
