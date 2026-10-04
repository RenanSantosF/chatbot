import { describe, expect, it } from "vitest";
import { primeiroLink, separarLinks } from "./links";

const links = (texto: string) =>
  separarLinks(texto)
    .filter((p) => p.tipo === "link")
    .map((p) => (p.tipo === "link" ? p.href : ""));

describe("links na mensagem", () => {
  it("acha http, www e domínio solto", () => {
    expect(links("veja https://loja.com/a?b=1 e www.sol.com.br ou sol.com.br/promo")).toEqual([
      "https://loja.com/a?b=1",
      "https://www.sol.com.br",
      "https://sol.com.br/promo",
    ]);
  });

  it("não leva a pontuação do fim da frase", () => {
    expect(links("Acesse https://loja.com/promo.")).toEqual(["https://loja.com/promo"]);
    expect(links("(veja https://x.com/a)")).toEqual(["https://x.com/a"]);
  });

  it("mantém o parêntese que faz parte do link", () => {
    expect(links("https://pt.wikipedia.org/wiki/Sol_(estrela)")).toEqual([
      "https://pt.wikipedia.org/wiki/Sol_(estrela)",
    ]);
  });

  it("e-mail, valor e abreviação não viram link", () => {
    expect(links("mande pra ana@loja.com.br, custa R$1.500, obs.: amanhã")).toEqual([]);
  });

  it("o texto em volta continua inteiro", () => {
    const pedacos = separarLinks("oi www.a.com tchau");
    expect(pedacos.map((p) => p.valor).join("")).toBe("oi www.a.com tchau");
  });

  it("o primeiro link é o da prévia", () => {
    expect(primeiroLink("a https://um.com b https://dois.com")).toBe("https://um.com");
    expect(primeiroLink("sem link")).toBeNull();
  });
});
