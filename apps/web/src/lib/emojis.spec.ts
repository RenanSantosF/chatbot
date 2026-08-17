import { describe, expect, it } from "vitest";
import { buscarEmojis, GRUPOS_DE_EMOJIS } from "./emojis";

/**
 * A busca é o que justifica o catálogo ter crescido.
 *
 * Com trinta emojis na tela, procurar não fazia sentido — cabia tudo à
 * vista. Com trezentos, a busca É a interface: quem quer o caminhão da
 * entrega não vai rolar sete seções atrás dele. Se ela falhar em
 * português, o catálogo maior vira só uma grade mais difícil que a antiga.
 */
describe("busca de emoji", () => {
  it("acha pela palavra em português", () => {
    expect(buscarEmojis("entrega")).toContain("🚚");
    expect(buscarEmojis("obrigado")).toContain("🙏");
    expect(buscarEmojis("dinheiro")).toContain("💰");
  });

  it("ignora acento — ninguém digita acento procurando emoji", () => {
    expect(buscarEmojis("coracao")).toContain("❤️");
    expect(buscarEmojis("coração")).toContain("❤️");
    expect(buscarEmojis("atencao")).toContain("⚠️");
  });

  it("ignora caixa e espaço em volta", () => {
    expect(buscarEmojis("  CAFÉ ")).toContain("☕");
  });

  it("acha por pedaço da palavra", () => {
    // Quem digita devagar vê o resultado filtrando a cada letra.
    expect(buscarEmojis("cami")).toContain("🚚");
  });

  it("não repete o emoji que aparece em mais de um grupo", () => {
    // 👍 está em "Usados no atendimento" e em "Gestos". Duas vezes na
    // grade parece defeito.
    const achados = buscarEmojis("joia");
    expect(achados.filter((e) => e === "👍")).toHaveLength(1);
  });

  it("busca vazia não devolve o catálogo inteiro", () => {
    // A tela mostra as seções quando não há busca; devolver tudo aqui
    // faria a grade piscar entre dois desenhos do mesmo conteúdo.
    expect(buscarEmojis("")).toEqual([]);
    expect(buscarEmojis("   ")).toEqual([]);
  });

  it("termo sem resultado devolve lista vazia, não erro", () => {
    expect(buscarEmojis("xyzabc")).toEqual([]);
  });
});

describe("catálogo", () => {
  it("toda entrada tem palavras de busca", () => {
    // Um emoji sem palavra-chave é um emoji que só se acha rolando — e é
    // exatamente o caso que a busca existe pra cobrir.
    const semChave = GRUPOS_DE_EMOJIS.flatMap((g) =>
      g.itens.filter((item) => item.k.trim().length === 0),
    );
    expect(semChave).toEqual([]);
  });

  it("cobre bem mais que a lista curta de antes", () => {
    const total = GRUPOS_DE_EMOJIS.reduce((n, g) => n + g.itens.length, 0);
    expect(total).toBeGreaterThan(150);
  });
});
