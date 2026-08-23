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

/** O sufixo de JID de conversa individual. */
const SUFIXO_PESSOA = '@s.whatsapp.net';

/** O de grupo. Tudo que termina assim é conversa de muita gente. */
const SUFIXO_GRUPO = '@g.us';

export interface ChaveDaMensagem {
  remoteJid: string;
  fromMe: boolean;
  id: string;
}

/**
 * O mesmo JID escrito sempre do mesmo jeito.
 *
 * Existe porque o id externo é comparado por igualdade exata, e o WhatsApp
 * escreve o MESMO destinatário de formas diferentes conforme o evento:
 *
 * - `5527999998888@s.whatsapp.net` na resposta do envio;
 * - `5527999998888:12@s.whatsapp.net` quando vem o aparelho junto;
 * - às vezes com espaço ou `+` que sobrou de quem digitou.
 *
 * Sem normalizar, a mensagem era gravada com uma forma e o evento de
 * entrega chegava com outra — a busca não achava nada, e o tique nunca
 * virava. O envio funcionava, o cliente recebia, e o balão ficava no
 * relógio pra sempre.
 *
 * O que NÃO dá pra normalizar é `@lid`, o identificador opaco que o
 * WhatsApp usa pra esconder o telefone: dele não se recupera o número.
 * Esse caso fica por conta da busca pelo id da mensagem (ver
 * `applyDeliveryStatus`).
 */
export function normalizarJid(remoteJid: string): string {
  const telefone = telefoneDoJid(remoteJid);
  return telefone ? jidDoTelefone(telefone) : remoteJid.trim();
}

export function empacotarId(chave: ChaveDaMensagem): string {
  return [
    normalizarJid(chave.remoteJid),
    chave.fromMe ? '1' : '0',
    chave.id,
  ].join(SEPARADOR);
}

/**
 * Só o id da mensagem dentro do pacote.
 *
 * É a parte que o WhatsApp garante única, e a única que nunca muda de
 * forma entre um evento e outro. Serve de rede pra quando a comparação
 * exata falha — `@lid`, formato novo, mensagem gravada por uma versão
 * anterior desta função.
 */
export function idDaMensagem(externo: string): string | null {
  const partes = externo.split(SEPARADOR);
  return partes.length === 3 ? (partes[2] || null) : null;
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

/** Este endereço é de grupo? */
export function ehGrupo(destino: string): boolean {
  return destino.trim().endsWith(SUFIXO_GRUPO);
}

/**
 * O JID de destino a partir do que está gravado no cliente.
 *
 * Para pessoa, guarda-se o telefone e monta-se o JID aqui: ele chega do
 * painel em formatos variados (com +, parênteses, traço) e o WhatsApp só
 * entende dígito.
 *
 * Para GRUPO, o que está gravado já É o JID (`120363...@g.us`), e ele
 * passa intacto. Sem esta saída, a limpeza de dígitos abaixo comeria o
 * `@g.us` e montaria `120363...@s.whatsapp.net` — um destino individual
 * que não existe, e o envio ia embora pra lugar nenhum.
 */
export function jidDoTelefone(telefone: string): string {
  if (ehGrupo(telefone)) return telefone.trim();
  return `${telefone.replace(/\D/g, '')}${SUFIXO_PESSOA}`;
}

/**
 * O telefone de volta, a partir do JID.
 *
 * Grupo devolve `null` de propósito, e continua assim mesmo agora que
 * grupo é atendido: ele não TEM telefone. Quem precisa lidar com grupo usa
 * `ehGrupo` e guarda o JID inteiro — ver `identidadeDoDestino`.
 */
export function telefoneDoJid(remoteJid: string): string | null {
  if (!remoteJid.endsWith(SUFIXO_PESSOA)) return null;
  const numero = remoteJid.slice(0, -SUFIXO_PESSOA.length).split(':')[0];
  return /^\d{8,15}$/.test(numero) ? numero : null;
}

/**
 * Como este destino é guardado no campo `phone` do cliente.
 *
 * Um lugar só pra decidir isso, porque a resposta é diferente pros dois
 * tipos e a diferença precisa ser consistente entre quem GRAVA (o webhook,
 * ao receber) e quem LÊ (o envio, ao montar o destino). Escrita nos dois
 * lugares, uma delas ia divergir na primeira mudança.
 *
 * `null` quando não é nem pessoa nem grupo — transmissão, status, e o que
 * mais o WhatsApp inventar. Esses continuam de fora.
 */
export function identidadeDoDestino(
  remoteJid: string,
): { identificador: string; grupo: boolean } | null {
  if (ehGrupo(remoteJid)) {
    return { identificador: remoteJid.trim(), grupo: true };
  }

  const telefone = telefoneDoJid(remoteJid);
  return telefone ? { identificador: telefone, grupo: false } : null;
}
