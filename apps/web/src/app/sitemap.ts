import type { MetadataRoute } from "next";
import { absoluto } from "@/lib/site";

/**
 * As páginas que existem sem login. São só cinco, e é isso mesmo: o resto
 * do produto vive atrás de sessão e não tem por que estar aqui.
 *
 * Termos, privacidade e exclusão de dados entram apesar de não trazerem
 * visita — a análise do app na Meta exige esses endereços públicos e
 * alcançáveis, e um sitemap que os lista é mais uma prova de que estão no
 * ar.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const agora = new Date();

  return [
    { url: absoluto("/"), lastModified: agora, changeFrequency: "weekly", priority: 1 },
    { url: absoluto("/register"), lastModified: agora, changeFrequency: "monthly", priority: 0.8 },
    { url: absoluto("/termos"), lastModified: agora, changeFrequency: "yearly", priority: 0.3 },
    { url: absoluto("/privacidade"), lastModified: agora, changeFrequency: "yearly", priority: 0.3 },
    {
      url: absoluto("/exclusao-de-dados"),
      lastModified: agora,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
