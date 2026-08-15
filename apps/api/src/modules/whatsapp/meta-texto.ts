const GRAPH_API_VERSION = 'v21.0';
// Mesma base sobrescrevível dos outros serviços de WhatsApp: aponta num
// ambiente de teste da Meta ou num servidor de mentira durante teste
// automatizado. Em produção fica no padrão.
const GRAPH_BASE = process.env.META_GRAPH_URL ?? 'https://graph.facebook.com';

export interface EnvioDeTexto {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  body: string;
  /** Faz a mensagem sair citando outra no aparelho do cliente. */
  replyToExternalId?: string | null;
}

export interface ResultadoDoEnvio {
  /** O wamid da Meta — é por ele que os webhooks de status encontram a mensagem. */
  wamid: string | null;
  /** Preenchido quando a Meta recusou ou a rede caiu. Já legível num log. */
  erro?: string;
  /**
   * A resposta crua e o código HTTP, quando houve resposta.
   *
   * Vão junto porque o motivo BONITO — o que aparece pro atendente no
   * balão — sai de `motivoDaMeta`, que precisa do corpo original pra achar
   * o `error_user_msg`. Sem eles, quem chama só teria a string de log e
   * mostraria "400: {json inteiro}" na tela de quem está atendendo.
   */
  corpo?: string;
  status?: number;
}

/**
 * A chamada crua de "manda este texto" pra Cloud API.
 *
 * Existe separada porque tem DOIS chamadores com naturezas diferentes: o
 * envio normal, que acontece dentro de uma requisição e tem o tenant
 * resolvido pelo Nest, e o encerramento automático, que é uma rotina de
 * fundo sem requisição nenhuma e por isso não pode injetar um serviço de
 * escopo de requisição. Duplicar a chamada nos dois lugares é como um dos
 * dois fica pra trás quando a versão da API da Meta muda.
 *
 * Não lança: quem chama decide o que fazer com a falha. Envio que não
 * chegou nunca pode derrubar o fluxo interno — a mensagem já está no painel
 * de qualquer jeito.
 */
export async function postarTexto({
  phoneNumberId,
  accessToken,
  to,
  body,
  replyToExternalId,
}: EnvioDeTexto): Promise<ResultadoDoEnvio> {
  const url = `${GRAPH_BASE}/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
        ...(replyToExternalId
          ? { context: { message_id: replyToExternalId } }
          : {}),
      }),
    });

    const corpo = await response.text();
    if (!response.ok) {
      return {
        wamid: null,
        erro: `${response.status}: ${corpo}`,
        corpo,
        status: response.status,
      };
    }

    return { wamid: extrairWamid(corpo) };
  } catch (error) {
    return {
      wamid: null,
      erro: error instanceof Error ? error.message : String(error),
    };
  }
}

/** O id da mensagem fica em `messages[0].id` na resposta da Meta. */
export function extrairWamid(corpo: string): string | null {
  try {
    const json = JSON.parse(corpo) as { messages?: { id?: string }[] };
    return json.messages?.[0]?.id ?? null;
  } catch {
    return null;
  }
}
