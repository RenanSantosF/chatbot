import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

/**
 * O que transforma o painel num aplicativo instalável.
 *
 * Com este arquivo o Chrome e o Edge passam a oferecer "Instalar app" no
 * desktop, e o Android oferece "Adicionar à tela inicial". O resultado é
 * uma janela própria — sem barra de endereço, com ícone na barra de
 * tarefas e no dock — que é o que se pediria a uma "versão desktop", sem
 * o custo de manter instalador, assinatura de código e atualização
 * automática por sistema operacional.
 *
 * O que ele NÃO faz: notificação com o app fechado. Isso depende de
 * service worker com Web Push, que é uma etapa à parte — enquanto ela não
 * existe, o aviso continua dependendo de a janela estar aberta (ver
 * realtime-provider).
 *
 * No iPhone não aparece botão de instalar: lá o caminho é Compartilhar >
 * "Adicionar à Tela de Início", e o `appleWebApp` no layout é o que faz
 * ele abrir em tela cheia depois disso.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — atendimento no WhatsApp`,
    // Curto porque é o que cabe embaixo do ícone na tela inicial; o
    // sistema corta o que passar disso com reticências.
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: "pt-BR",
    /*
     * Abre direto no Inbox, e não na raiz.
     *
     * Quem instalou o aplicativo instalou pra atender: cair na página de
     * apresentação do produto e ter que navegar até a caixa seria gastar
     * dois toques por abertura, todo dia. Quem não estiver logado é
     * mandado pro login normalmente.
     */
    start_url: "/dashboard/inbox",
    scope: "/",
    display: "standalone",
    /*
     * Branco, mesmo com o tema padrão sendo o do sistema.
     *
     * Esta cor pinta a tela de abertura, no intervalo entre tocar no ícone
     * e o app desenhar — e o manifest não aceita duas cores por preferência
     * de tema, como o `themeColor` do viewport aceita. Entre piscar branco
     * pra quem usa tema escuro e piscar preto pra quem usa claro, o branco
     * é o menos agressivo, e é o fundo da marca em qualquer contexto
     * impresso.
     */
    background_color: "#ffffff",
    theme_color: "#0f6b4f",
    categories: ["business", "productivity"],
    icons: [
      { src: "/marca/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/marca/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      /*
       * A versão mascarável é outro arquivo, e não o mesmo com outro
       * rótulo: o sistema recorta o ícone na forma dele — círculo no
       * Android — e só garante que os 80% centrais sobrevivem. O ícone
       * transparente viraria um recorte com buraco no meio, então esta
       * versão tem fundo cheio e o desenho encolhido pra dentro da zona
       * segura.
       */
      {
        src: "/marca/icone-mascaravel-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
