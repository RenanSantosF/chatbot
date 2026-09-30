/**
 * O servidor desenha as horas no fuso do Brasil.
 *
 * A primeira página do Inbox sai pronta do servidor (ver
 * app/dashboard/page.tsx), com a hora de cada conversa e de cada
 * mensagem. O servidor roda em UTC; o navegador, em Brasília. O mesmo
 * "13:27" saía "16:27" do servidor, o React via o texto diferente ao
 * assumir a página e registrava o erro #418 (hidratação) — era o que
 * aparecia nos erros da plataforma.
 *
 * `TZ` definido no ambiente continua mandando: isto é só o padrão.
 */
export function register() {
  process.env.TZ ??= "America/Sao_Paulo";
}
