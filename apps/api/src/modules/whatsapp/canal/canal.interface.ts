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
 * MÍDIA AINDA NÃO ESTÁ AQUI, e a ausência é deliberada.
 *
 * Na Meta enviar um arquivo são duas viagens — sobe o binário, recebe um
 * `mediaId`, envia a mensagem citando esse id — e aquele id é guardado na
 * mensagem porque é por ele que o anexo é rebaixado e arquivado depois. Na
 * Evolution o arquivo vai direto, e esse id não existe.
 *
 * Ou seja: não é só um método a mais, é um conceito do modelo de dados que
 * precisa mudar junto. Enfiar `mediaId` nesta interface seria vazar a Meta
 * pra dentro do contrato que existe justamente pra escondê-la. Até esse
 * redesenho, quem envia anexo continua falando com o serviço da Meta
 * diretamente — o que é honesto, porque hoje só existe ela.
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

  /** O porquê da última falha, em português, pra mostrar a quem atende. */
  readonly motivoDaUltimaFalha: string | null;
}
