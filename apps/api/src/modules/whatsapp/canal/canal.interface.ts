/**
 * O contrato de um canal de mensagens.
 *
 * Isto existe porque o resto do sistema NÃO deveria saber quem entrega a
 * mensagem. Hoje é a Cloud API da Meta; amanhã pode ser um BSP de repasse,
 * ou a Evolution rodando num servidor nosso. Cada um desses tem burocracia,
 * custo e risco diferentes, e a escolha entre eles é comercial — não deve
 * exigir reescrever o produto.
 *
 * A medida veio do próprio código: as conversas, a IA e o Inbox somam mais
 * de vinte mil linhas, e falam com o WhatsApp por OITO chamadas. São essas
 * oito que estão aqui. Tudo o mais no módulo — assinatura de webhook,
 * conversão de áudio, upload em duas etapas — é detalhe de um provedor
 * específico e fica atrás desta porta.
 *
 * Duas decisões que valem explicação:
 *
 * 1. Nada aqui lança por falha de entrega. Mensagem que não saiu vira
 *    `null` (ou `false`), e quem chamou marca a mensagem como falha e
 *    mostra o motivo. Erro de rede do WhatsApp nunca pode derrubar o fluxo
 *    interno de conversa, que já gravou tudo.
 *
 * 2. `motivoDaUltimaFalha` é um `get`, e não um retorno. Mudar a assinatura
 *    de seis métodos por causa de um caso de erro espalharia tratamento por
 *    todos os chamadores; o serviço tem escopo de requisição, então o
 *    motivo não vaza entre pedidos simultâneos.
 *
 * MÍDIA ENTROU DEPOIS, e o redesenho que ela exigia foi este:
 *
 * A versão anterior deste comentário explicava por que mídia estava de
 * fora — o parâmetro seria o `mediaId`, que vem do upload em duas etapas
 * da Cloud API e não existe na Evolution. Enfiá-lo aqui vazaria a Meta pra
 * dentro do contrato feito pra escondê-la.
 *
 * A saída foi inverter: o contrato recebe o ARQUIVO e devolve um `handle`
 * opaco. Cada provedor decide o que aquele handle significa — na Meta é o
 * `mediaId` do upload, na Evolution é a chave da mensagem, que é por onde
 * ela devolve o binário. Quem guarda no banco só precisa devolver o mesmo
 * valor quando quiser o arquivo de volta, exatamente como já acontecia com
 * o id externo.
 */

/**
 * Um modelo já aprovado pela plataforma.
 *
 * Os nomes ficam em inglês porque este objeto vai inteiro pro painel, e
 * traduzir aqui obrigaria a converter no caminho — trabalho sem ganho num
 * formato que só existe pra atravessar a API.
 */
export interface ModeloAprovado {
  name: string;
  language: string;
  /** O texto do corpo, pra tela mostrar o que vai ser enviado. */
  body: string;
  /** Quantos {{1}}, {{2}}... a empresa precisa preencher no envio. */
  placeholders: number;
}

/**
 * O identificador que o provedor devolve ao aceitar uma mensagem.
 *
 * Na Meta é o `wamid`; em outros provedores é outra coisa. O sistema só
 * precisa que ele seja estável e que volte nos eventos de status — é por
 * ele que o tique de entregue e lido encontra a linha certa.
 */
export type IdExterno = string;

export interface CanalDeMensagem {
  /** @returns o id externo, ou null quando a mensagem não saiu */
  enviarTexto(
    para: string,
    texto: string,
    citando?: IdExterno | null,
  ): Promise<IdExterno | null>;

  enviarReacao(para: string, mensagem: IdExterno, emoji: string): Promise<void>;

  /** O tique azul no aparelho do cliente. Falhar aqui não é grave. */
  marcarComoLida(mensagem: IdExterno): Promise<void>;

  /**
   * Modelos aprovados, pra iniciar conversa fora da janela de 24h.
   *
   * Nem todo provedor tem isso — é uma regra da plataforma oficial, não do
   * WhatsApp. Quem não tiver devolve lista vazia, e a tela esconde o
   * recurso sozinha.
   */
  listarModelos(): Promise<ModeloAprovado[]>;

  /**
   * Inicia conversa por modelo aprovado.
   *
   * Diferente dos outros, este PROPAGA o erro: quem inicia uma conversa
   * precisa saber na hora que foi recusado, senão fica olhando pra uma
   * conversa vazia sem entender por quê.
   */
  enviarModelo(
    para: string,
    modelo: { name: string; language: string; bodyParams?: string[] },
  ): Promise<IdExterno>;

  /**
   * Envia um arquivo.
   *
   * O argumento é o ARQUIVO, e não um identificador dele. Essa escolha é a
   * que tirou a Meta de dentro do contrato: antes o parâmetro era o
   * `mediaId` do upload em duas etapas — sobe o binário, recebe um id,
   * envia a mensagem citando esse id — que só existe na Cloud API. A
   * Evolution manda o arquivo direto, e não tem id nenhum pra citar.
   *
   * Cada provedor faz o que precisa por dentro: a Meta sobe antes, a
   * Evolution manda em base64. Quem chama não sabe a diferença.
   */
  enviarMidia(
    para: string,
    arquivo: ArquivoParaEnvio,
    opcoes?: { caption?: string; citando?: IdExterno | null },
  ): Promise<EnvioDeMidia>;

  /**
   * Busca o binário de uma mídia pelo `handle` que o envio ou o
   * recebimento guardou.
   *
   * `null` quer dizer "não consegui buscar", e não "não existe": quem
   * chama decide se tenta outra fonte (o arquivamento próprio) ou se
   * mostra o balão sem o anexo.
   */
  baixarMidia(handle: string): Promise<MidiaBaixada | null>;

  /** O porquê da última falha, em português, pra mostrar a quem atende. */
  readonly motivoDaUltimaFalha: string | null;
}

/** O que o WhatsApp trata como categorias diferentes de anexo. */
export type TipoDeMidia =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker';

export interface ArquivoParaEnvio {
  buffer: Buffer;
  mimetype: string;
  filename: string;
  tipo: TipoDeMidia;
  /**
   * Áudio gravado na hora, e não arquivo de música anexado.
   *
   * A diferença é visível pro cliente: um vira a bolha de mensagem de voz
   * com forma de onda, o outro vira um anexo com nome de arquivo. Os dois
   * provedores têm caminhos separados pra isso.
   */
  voice?: boolean;
}

export interface EnvioDeMidia {
  /** O id da mensagem, ou null quando o anexo não saiu. */
  externalId: IdExterno | null;
  /**
   * Por onde buscar este binário depois.
   *
   * Na Meta é o `mediaId` do upload; na Evolution é a chave da mensagem,
   * porque é por ela que o servidor devolve o arquivo. Quem guarda não
   * precisa saber qual dos dois é — só devolver este mesmo valor em
   * `baixarMidia`.
   */
  handle: string | null;
}

export interface MidiaBaixada {
  buffer: Buffer;
  mimeType: string;
}
