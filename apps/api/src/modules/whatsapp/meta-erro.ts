/**
 * Extrai a explicação de dentro de um erro da Cloud API.
 *
 * A Meta responde erro em três formatos diferentes conforme onde ele
 * acontece: `error.error_user_msg` (texto pronto pra mostrar a humanos),
 * `error.message` (técnico) e — quando quem recusa é o proxy dela, não a
 * API — HTML puro. O último caso é o motivo de isto existir: chamar
 * `.json()` direto derrubava a requisição com erro de parse, e o atendente
 * recebia "erro interno" no lugar de "a Meta está fora do ar".
 */
export function motivoDaMeta(body: string, status: number): string {
  try {
    const payload = JSON.parse(body) as {
      error?: { message?: string; error_user_msg?: string };
    };
    const motivo = payload.error?.error_user_msg ?? payload.error?.message;
    if (motivo) return motivo;
  } catch {
    /* resposta não-JSON: cai no código HTTP abaixo */
  }
  return `erro HTTP ${status}`;
}
