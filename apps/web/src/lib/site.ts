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

/**
 * O nome da marca, e a ÚNICA definição dele.
 *
 * Já foi outro: o produto nasceu como "Clara" e virou Inteliwa quando a
 * empresa foi aberta. A troca passou por dez arquivos porque o nome estava
 * escrito à mão em cada um — cabeçalho, rodapé, título da aba, imagem de
 * compartilhamento, termos, privacidade. Agora todos importam daqui, e uma
 * eventual próxima troca é esta linha.
 */
export const SITE_NAME = "Inteliwa";

/**
 * A frase que aparece embaixo do título no Google e no card do WhatsApp.
 *
 * Escrita pelo problema, não pelo recurso: quem procura isso digita
 * "responder cliente no WhatsApp automático", não "plataforma omnichannel
 * com RAG". Cabe nos ~155 caracteres que o Google mostra antes de cortar.
 */
export const SITE_DESCRIPTION =
  "A Inteliwa atende no WhatsApp da sua empresa com inteligência artificial: responde sozinha o que é repetitivo e chama sua equipe quando o assunto pede gente.";

/**
 * Quem é a empresa, juridicamente.
 *
 * Não é enfeite de rodapé: a revisão do app na Meta confere se o site
 * identifica a empresa por trás dele, e a LGPD exige um canal de contato
 * para titular de dados. Sem isso, a política de privacidade é um texto
 * sem dono.
 *
 * Começa VAZIO de propósito. Os blocos que dependem destes valores só são
 * desenhados quando eles existem — assim nada como "PREENCHER AQUI" pode
 * ir ao ar por esquecimento, e completar a linha faz o bloco aparecer.
 */
export const EMPRESA = {
  /** Razão social exatamente como no Cartão CNPJ. */
  razaoSocial: "",
  /** Só os números ou já formatado — o que for, aparece como está escrito. */
  cnpj: "",
  /** E-mail no domínio próprio. Gmail pessoal reprova no App Review. */
  email: "",
};

/** Há identificação suficiente pra desenhar o bloco "quem somos"? */
export const temIdentificacao = Boolean(EMPRESA.razaoSocial && EMPRESA.cnpj);

export const absoluto = (caminho: string) =>
  `${SITE_URL}${caminho.startsWith("/") ? caminho : `/${caminho}`}`;
