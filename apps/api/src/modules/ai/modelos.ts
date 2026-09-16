/**
 * O modelo padrão do Gemini usado por toda a plataforma.
 *
 * Flash Lite é o mais barato e o mais rápido da família, e atendimento é
 * exatamente o caso de uso que isso atende: perguntas curtas, respostas
 * curtas, muitas por dia — o que também mantém o custo por mensagem baixo
 * o bastante pra sustentar um limite generoso por conta (ver AiUsageService).
 *
 * Quem administra a plataforma pode trocar sem deploy via a variável de
 * ambiente `GEMINI_MODEL` (ver AiCredentialsResolver) — isto aqui é só o
 * valor de fallback quando essa variável não está definida.
 */
export const MODELO_PADRAO = 'gemini-3.1-flash-lite';
