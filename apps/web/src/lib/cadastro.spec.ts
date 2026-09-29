import { describe, expect, it } from "vitest";
import {
  erroDaEmpresa,
  erroDaSenha,
  erroDoEmail,
  erroDoNome,
  forcaDaSenha,
  iniciais,
  primeiroNome,
} from "./cadastro";

describe("cadastro", () => {
  it("chama a pessoa pelo primeiro nome", () => {
    expect(primeiroNome("  Renan Santos Ferreira ")).toBe("Renan");
    expect(primeiroNome("")).toBe("");
  });

  it("iniciais da empresa pra prévia", () => {
    expect(iniciais("Clínica Sorriso")).toBe("CS");
    expect(iniciais("Padaria Pão de Mel")).toBe("PM");
    expect(iniciais("Inteliwa")).toBe("IN");
    expect(iniciais("  ")).toBe("");
  });

  it("valida cada passo como o servidor", () => {
    expect(erroDoNome("R")).not.toBeNull();
    expect(erroDoNome("Renan")).toBeNull();
    expect(erroDaEmpresa(" ")).not.toBeNull();
    expect(erroDaEmpresa("Clínica")).toBeNull();
    expect(erroDoEmail("renan@")).not.toBeNull();
    expect(erroDoEmail("renan@empresa")).not.toBeNull();
    expect(erroDoEmail(" renan@empresa.com.br ")).toBeNull();
    expect(erroDaSenha("1234567")).not.toBeNull();
    expect(erroDaSenha("12345678")).toBeNull();
  });

  it("mede a senha em três degraus, exigindo só o tamanho", () => {
    expect(forcaDaSenha("").nivel).toBe(0);
    expect(forcaDaSenha("abc").nivel).toBe(1);
    expect(forcaDaSenha("abcdefgh").nivel).toBe(1);
    expect(forcaDaSenha("abcdefg1").nivel).toBe(2);
    expect(forcaDaSenha("Abcdefg1").nivel).toBe(3);
  });
});
