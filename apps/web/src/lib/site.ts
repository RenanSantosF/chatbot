/**
 * Endereço público do site, num lugar só.
 *
 * Existe porque metadado de SEO não tolera caminho relativo: `og:image`,
 * `canonical`, sitemap e robots precisam de URL absoluta, e o buscador
 * resolve a relativa contra o domínio dele, não contra o nosso. Um deploy
 * sem `NEXT_PUBLIC_SITE_URL` continua funcionando — só não deve ser o de
 * produção, porque as tags apontariam pro localhost de quem gerou o build.
 *
 * `NEXT_PUBLIC_*` é embutida no bundle durante o `next build`, então trocar
 * o valor exige um build novo (ver DEPLOY.md).
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

export const SITE_NAME = "Clara";

/**
 * A frase que aparece embaixo do título no Google e no card do WhatsApp.
 *
 * Escrita pelo problema, não pelo recurso: quem procura isso digita
 * "responder cliente no WhatsApp automático", não "plataforma omnichannel
 * com RAG". Cabe nos ~155 caracteres que o Google mostra antes de cortar.
 */
export const SITE_DESCRIPTION =
  "A Clara atende no WhatsApp da sua empresa com inteligência artificial: responde sozinha o que é repetitivo e chama sua equipe quando o assunto pede gente.";

export const absoluto = (caminho: string) =>
  `${SITE_URL}${caminho.startsWith("/") ? caminho : `/${caminho}`}`;
