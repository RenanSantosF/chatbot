/**
 * O servidor de mensagens é NOSSO, e não do cliente.
 *
 * A tela de conexão começou pedindo o endereço do servidor e a chave da
 * API, e isso estava errado por três motivos, em ordem crescente de
 * gravidade.
 *
 * 1. Não é informação do cliente. Ele contratou um atendimento com IA no
 *    WhatsApp; qual servidor entrega a mensagem é decisão de arquitetura
 *    nossa, e perguntar isso é pedir que ele saiba como o produto é
 *    construído por dentro.
 *
 * 2. Vira suporte. Um endereço colado sem `https://`, com barra sobrando,
 *    ou do serviço errado no painel de hospedagem produz o sintoma mais
 *    confuso que existe aqui: conecta, o QR code funciona, e nenhuma
 *    mensagem aparece.
 *
 * 3. É um buraco de isolamento — e este é o motivo de verdade. A chave da
 *    Evolution é GLOBAL: quem a tem cria, lê e APAGA qualquer sessão do
 *    servidor, não só a sua. Pedi-la a cada empresa significava entregar
 *    a cada cliente o poder de derrubar o WhatsApp de todos os outros. Não
 *    é um detalhe de tela: é uma falha de multi-inquilino que nenhuma
 *    quantidade de cuidado no painel conserta, porque a chave já estava na
 *    mão de quem não devia tê-la.
 *
 * Então ela mora aqui, no ambiente da API, e nunca sai deste processo.
 *
 * As colunas por empresa continuam no banco de propósito — ver
 * `credenciaisDoTenant`. Quem já conectou com servidor próprio continua
 * funcionando, e o dia em que uma empresa grande exigir a infraestrutura
 * dela não vai precisar de migração nenhuma. O que mudou é o PADRÃO, e
 * quem responde por ele.
 */

export interface ServidorDeMensagens {
  baseUrl: string;
  apiKey: string;
}

/**
 * O servidor padrão da plataforma, lido do ambiente.
 *
 * `null` quando não está configurado — e aí a conexão por QR code
 * simplesmente não é oferecida, em vez de estourar no meio do caminho.
 */
export function servidorDaPlataforma(): ServidorDeMensagens | null {
  const bruto = process.env.EVOLUTION_BASE_URL?.trim();
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  if (!bruto || !apiKey) return null;

  return { baseUrl: normalizarEndereco(bruto), apiKey };
}

/**
 * Conserta o endereço antes que ele vire defeito.
 *
 * Os dois erros são os mesmos de sempre, agora cometidos por nós e não
 * pelo cliente: o painel de hospedagem mostra o domínio pelado
 * ("algo.up.railway.app"), e a barra do fim sobra ao copiar. Sem esquema
 * não é endereço, é texto; com barra dupla, algumas rotas respondem 404
 * sem explicar nada.
 */
export function normalizarEndereco(endereco: string): string {
  const comEsquema = /^https?:\/\//i.test(endereco)
    ? endereco
    : `https://${endereco}`;
  return comEsquema.replace(/\/+$/, '');
}
