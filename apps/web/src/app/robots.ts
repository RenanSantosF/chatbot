import type { MetadataRoute } from "next";
import { absoluto } from "@/lib/site";

/**
 * O que o buscador pode visitar.
 *
 * O painel fica de fora, e não por segredo — ele já exige sessão. É pra o
 * robô não gastar o orçamento de rastreamento dele em dezenas de URLs que
 * só respondem redirecionamento pro login, e pra nenhuma delas competir
 * com a landing no resultado de busca.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/dashboard/", "/api/"],
    },
    sitemap: absoluto("/sitemap.xml"),
    host: absoluto("/"),
  };
}
