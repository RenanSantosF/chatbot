import type { ConversationMessage } from "@/lib/types";

/**
 * Onde entra a tarja "não lidas" e quantas ela conta.
 *
 * O contador do servidor conta mensagens de cliente, então a conta é de
 * trás pra frente pulando as nossas — e para no que já foi visto
 * (`vistoAte`), porque o contador pode estar atrás do que a pessoa viu
 * chegar na frente dela.
 */
export function ondeComecamAsNaoLidas(
  mensagens: ConversationMessage[] | undefined,
  pedidas: number,
  vistoAte: number,
): { primeiraNaoLida: string | null; naoLidasAoAbrir: number } {
  if (!mensagens || pedidas <= 0)
    return { primeiraNaoLida: null, naoLidasAoAbrir: 0 };
  let achadas = 0;
  let primeira: string | null = null;
  for (let i = mensagens.length - 1; i >= 0; i -= 1) {
    const mensagem = mensagens[i];
    if (new Date(mensagem.createdAt).getTime() <= vistoAte) break;
    if (mensagem.senderType !== "CUSTOMER") continue;
    achadas += 1;
    primeira = mensagem.id;
    if (achadas === pedidas)
      return { primeiraNaoLida: primeira, naoLidasAoAbrir: achadas };
  }
  // Parou no que já tinha sido visto: as não lidas são só as de depois.
  if (vistoAte > 0 && primeira)
    return { primeiraNaoLida: primeira, naoLidasAoAbrir: achadas };
  // Menos mensagens carregadas que não lidas: a conversa foi aberta numa
  // página antiga do histórico. Marcar a primeira da página seria mentira.
  return { primeiraNaoLida: null, naoLidasAoAbrir: 0 };
}
