import { describe, expect, it } from "vitest";
import { proporcaoDaMiniatura } from "./miniatura";

describe("proporcaoDaMiniatura", () => {
  it("mantém a proporção da foto quando ela está dentro da faixa", () => {
    expect(proporcaoDaMiniatura(1000, 1000)).toBe(1);
    expect(proporcaoDaMiniatura(1000, 1100)).toBe(1.1);
  });

  it("corta um comprovante comprido em retrato 4:5", () => {
    expect(proporcaoDaMiniatura(600, 2400)).toBe(1.25);
  });

  it("corta um panorama em paisagem 4:3", () => {
    expect(proporcaoDaMiniatura(4000, 1000)).toBe(0.75);
  });

  it("cai no quadrado quando a imagem não informa o tamanho", () => {
    expect(proporcaoDaMiniatura(0, 0)).toBe(1);
  });
});
