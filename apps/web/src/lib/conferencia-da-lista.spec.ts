import { describe, expect, it } from "vitest";
import { conferirPrimeiraPagina } from "./conferencia-da-lista";

const a = { id: "a", lastMessageAt: "10:00", unreadCount: 0 };
const b = { id: "b", lastMessageAt: "09:00", unreadCount: 0 };
const c = { id: "c", lastMessageAt: "08:00", unreadCount: 0 };

describe("conferirPrimeiraPagina", () => {
  it("não vê mudança quando o servidor devolve a mesma página", () => {
    const resultado = conferirPrimeiraPagina([a, b, c], [{ ...a }, { ...b }, { ...c }]);
    expect(resultado.mudou).toBe(false);
    expect(resultado.mudaram.size).toBe(0);
  });

  it("ignora as páginas que a pessoa já rolou além da primeira", () => {
    expect(conferirPrimeiraPagina([a, b, c], [a, b]).mudou).toBe(false);
  });

  it("vê a conversa que chegou no intervalo", () => {
    const nova = { id: "d", lastMessageAt: "10:01", unreadCount: 1 };
    const resultado = conferirPrimeiraPagina([a, b], [nova, a]);
    expect(resultado.mudou).toBe(true);
    expect([...resultado.mudaram]).toEqual(["d"]);
  });

  it("vê mensagem nova numa conversa que já estava na tela", () => {
    const resultado = conferirPrimeiraPagina(
      [a, b],
      [{ ...b, lastMessageAt: "10:02", unreadCount: 1 }, a],
    );
    expect(resultado.mudou).toBe(true);
    expect([...resultado.mudaram]).toEqual(["b"]);
  });

  it("vê a conversa que saiu do recorte", () => {
    const resultado = conferirPrimeiraPagina([a, b, c], [a, c]);
    expect(resultado.mudou).toBe(true);
    expect(resultado.mudaram.size).toBe(0);
  });
});
