/**
 * O visual do campo onde se escreve: o da mensagem e o da legenda do anexo.
 *
 * Preenchido e sem moldura, como no WhatsApp. Antes era o campo de
 * formulário padrão — borda clara com sombra —, que no tema escuro virava
 * um contorno branco brilhando em volta do lugar onde a pessoa passa o dia
 * digitando. O foco só firma a borda de leve: o cursor piscando já diz
 * onde se está.
 *
 * Num lugar só pra os dois campos não divergirem de novo.
 */
export const CAMPO_DE_MENSAGEM =
  "field-sizing-content max-h-36 min-h-10 w-full min-w-0 flex-1 resize-none rounded-lg border border-transparent bg-muted px-3.5 py-[9px] text-base leading-snug outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-foreground/10 disabled:cursor-not-allowed disabled:opacity-50 md:text-[15px] dark:bg-input/40";
