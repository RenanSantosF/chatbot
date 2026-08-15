/**
 * O identificador de mensagem na Evolution, e por que ele é composto.
 *
 * A Meta devolve um `wamid` que basta sozinho: dá pra marcar como lida ou
 * reagir tendo só ele. A Evolution não — toda operação sobre uma mensagem
 * exige a CHAVE inteira: com quem é a conversa (`remoteJid`), quem
 * escreveu (`fromMe`) e o id em si. Só o id não localiza nada.
 *
 * Havia duas saídas. Uma era acrescentar parâmetros à interface do canal —
 * telefone e "foi nossa?" em `marcarComoLida` e `enviarReacao` — o que
 * empurraria detalhe da Evolution pra dentro do contrato que existe pra
 * escondê-la, e pra dentro dos chamadores, que teriam de carregar dados
 * que a Meta ignora.
 *
 * A outra, que é esta: o id externo da Evolution É a chave inteira,
 * empacotada numa string. O contrato já dizia que o id externo é opaco e
 * só precisa ser estável e voltar nos eventos de status — e é
 * exatamente o que ele continua sendo. Quem guarda no banco não precisa
 * saber o que tem dentro; quem desempacota é só este provedor.
 *
 * O separador é `|` porque não aparece em JID nem nos ids da Evolution
 * (base32 e hexadecimal), então nunca há ambiguidade ao desempacotar.
 */

const SEPARADOR = '|';

/** O sufixo de JID de conversa individual. Grupo usa outro, e não atendemos grupo. */
const SUFIXO_PESSOA = '@s.whatsapp.net';

export interface ChaveDaMensagem {
  remoteJid: string;
  fromMe: boolean;
  id: string;
}

export function empacotarId(chave: ChaveDaMensagem): string {
  return [chave.remoteJid, chave.fromMe ? '1' : '0', chave.id].join(SEPARADOR);
}

/**
 * Desfaz o empacotamento.
 *
 * Devolve `null` em vez de lançar porque o id vem do banco, e uma linha
 * antiga (ou gravada por outro provedor) não pode derrubar a abertura de
 * uma conversa. Quem chama simplesmente pula a operação.
 */
export function desempacotarId(externo: string): ChaveDaMensagem | null {
  const partes = externo.split(SEPARADOR);
  if (partes.length !== 3) return null;

  const [remoteJid, fromMe, id] = partes;
  if (!remoteJid || !id) return null;

  return { remoteJid, fromMe: fromMe === '1', id };
}

/**
 * O JID de uma conversa individual a partir do telefone.
 *
 * Guarda só os dígitos: o telefone chega do painel em formatos variados
 * (com +, com parênteses, com traço) e o WhatsApp só entende dígito.
 */
export function jidDoTelefone(telefone: string): string {
  return `${telefone.replace(/\D/g, '')}${SUFIXO_PESSOA}`;
}

/**
 * O telefone de volta, a partir do JID.
 *
 * Grupos e transmissões devolvem `null` — o sistema é de atendimento
 * individual, e tratar mensagem de grupo como conversa de cliente criaria
 * um "cliente" com o id do grupo, misturando o que várias pessoas
 * escreveram numa conversa só.
 */
export function telefoneDoJid(remoteJid: string): string | null {
  if (!remoteJid.endsWith(SUFIXO_PESSOA)) return null;
  const numero = remoteJid.slice(0, -SUFIXO_PESSOA.length).split(':')[0];
  return /^\d{8,15}$/.test(numero) ? numero : null;
}
