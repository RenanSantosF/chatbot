import { describe, expect, it } from "vitest";
import { ondeComecamAsNaoLidas } from "./nao-lidas";
import type { ConversationMessage } from "./types";

const msg = (id: string, senderType: string, minuto: number) =>
  ({
    id,
    senderType,
    createdAt: new Date(Date.UTC(2026, 8, 29, 13, minuto)).toISOString(),
  }) as ConversationMessage;
const em = (minuto: number) => Date.UTC(2026, 8, 29, 13, minuto);

const conversa = [
  msg("a", "CUSTOMER", 1),
  msg("b", "AGENT", 2),
  msg("c", "CUSTOMER", 3),
  msg("d", "AGENT", 4),
  msg("e", "CUSTOMER", 5),
];

describe("tarja de não lidas", () => {
  it("conta do fim pulando as mensagens da empresa", () => {
    expect(ondeComecamAsNaoLidas(conversa, 2, 0)).toEqual({
      primeiraNaoLida: "c",
      naoLidasAoAbrir: 2,
    });
  });

  it("sem não lidas, sem tarja", () => {
    expect(ondeComecamAsNaoLidas(conversa, 0, 0).primeiraNaoLida).toBeNull();
  });

  it("não marca o que já foi visto, mesmo com o contador atrasado", () => {
    // O servidor ainda diz 1, mas tudo até "e" já esteve na tela.
    expect(
      ondeComecamAsNaoLidas(conversa, 1, em(5)).primeiraNaoLida,
    ).toBeNull();
    // Diz 3, mas só "e" chegou depois do que foi visto.
    expect(ondeComecamAsNaoLidas(conversa, 3, em(4))).toEqual({
      primeiraNaoLida: "e",
      naoLidasAoAbrir: 1,
    });
  });

  it("página carregada menor que as não lidas: não inventa lugar", () => {
    expect(ondeComecamAsNaoLidas(conversa, 10, 0).primeiraNaoLida).toBeNull();
  });
});
