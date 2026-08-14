export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Quando não há explicação nenhuma no corpo da resposta.
 *
 * O `statusText` cru é o que o navegador chama aquele número, não o que
 * aconteceu: "Internal Server Error" numa tela de teste da IA parece um
 * defeito do produto quando quase sempre é uma chamada que demorou demais
 * e foi cortada no caminho — e a pessoa fica sem saber se tenta de novo ou
 * se abre um chamado.
 *
 * A API responde com `message` em toda falha que ela mesma trata. Cair
 * aqui significa que a resposta nem chegou a ser dela.
 */
function semCorpo(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return "O servidor não respondeu a tempo. Tente de novo em alguns instantes.";
  }
  if (status >= 500) {
    return "O servidor falhou ao responder. Se continuar, veja os registros da API.";
  }
  return `A requisição falhou (${status}).`;
}

export async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (Array.isArray(body?.message)) return body.message.join(" ");
    if (typeof body?.message === "string") return body.message;
    return semCorpo(res.status);
  } catch {
    return semCorpo(res.status);
  }
}
