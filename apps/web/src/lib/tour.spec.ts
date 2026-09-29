import { describe, expect, it } from "vitest";
import { posicionarCartao } from "./tour";

const tela = { width: 1440, height: 900 };
const cartao = { width: 340, height: 220 };

describe("tour: onde o cartão fica", () => {
  it("sem alvo, no centro", () => {
    expect(posicionarCartao(null, tela, cartao)).toEqual({
      top: 340,
      left: 550,
      lado: "centro",
    });
  });

  it("item do trilho à esquerda: cartão à direita, alinhado ao item", () => {
    const pos = posicionarCartao(
      { top: 100, left: 8, width: 40, height: 40 },
      tela,
      cartao,
    );
    expect(pos.lado).toBe("direita");
    expect(pos.left).toBe(8 + 40 + 18);
    expect(pos.top).toBe(16); // centro ficaria acima da tela: encosta na margem
  });

  it("alvo encostado à direita e embaixo: cartão por cima", () => {
    const pos = posicionarCartao(
      { top: 820, left: 1380, width: 48, height: 48 },
      tela,
      cartao,
    );
    expect(pos.lado).toBe("cima");
    expect(pos.left + cartao.width).toBeLessThanOrEqual(tela.width - 16);
  });

  it("alvo ocupando quase a tela toda: cartão continua dentro dela", () => {
    const pos = posicionarCartao(
      { top: 0, left: 60, width: 1370, height: 900 },
      tela,
      cartao,
    );
    expect(pos.top).toBeGreaterThanOrEqual(16);
    expect(pos.left).toBeGreaterThanOrEqual(16);
    expect(pos.left + cartao.width).toBeLessThanOrEqual(tela.width - 16);
  });
});
