import { describe, expect, it } from "vitest";
import { agoraNaEmpresa, dentroDoExpediente, descreverEspera } from "./espera";

/**
 * O alarme de espera, e por que ele cala fora do expediente.
 *
 * Todos os instantes aqui são escritos em UTC e conferidos no fuso de São
 * Paulo, que é UTC-3. É de propósito: o servidor roda em UTC, o navegador
 * de quem atende pode estar em qualquer fuso, e a única referência que vale
 * é o relógio da EMPRESA. Fazer a conta com qualquer um dos outros dois
 * erra — e erra justamente perto da meia-noite, onde o dia da semana também
 * muda.
 */
const SP = "America/Sao_Paulo";

const comercial = {
  expediente: {
    "1": [["08:00", "18:00"]] as [string, string][],
    "2": [["08:00", "18:00"]] as [string, string][],
    "3": [["08:00", "18:00"]] as [string, string][],
    "4": [["08:00", "18:00"]] as [string, string][],
    "5": [["08:00", "18:00"]] as [string, string][],
  },
  fuso: SP,
};

const semExpediente = { expediente: null, fuso: SP };

// Segunda-feira, 17 de agosto de 2026.
const segunda = (hhmm: string) => new Date(`2026-08-17T${hhmm}:00Z`);
const horasAntes = (momento: Date, horas: number) =>
  new Date(momento.getTime() - horas * 60 * 60 * 1000).toISOString();

describe("que horas são pra empresa", () => {
  it("desconta o fuso, e com ele o dia da semana", () => {
    // 01:00 UTC de segunda ainda é domingo, 22:00, em São Paulo. É este
    // caso que faria um expediente "de segunda a sexta" parecer aberto num
    // domingo à noite.
    expect(agoraNaEmpresa(SP, segunda("01:00"))).toEqual({ dia: 0, minutos: 22 * 60 });
  });

  it("fuso inválido não derruba a lista", () => {
    expect(() => agoraNaEmpresa("Marte/Olympus", segunda("13:00"))).not.toThrow();
  });
});

describe("está aberto?", () => {
  it("sim, no meio do expediente", () => {
    // 13:00 UTC = 10:00 em SP.
    expect(dentroDoExpediente(comercial, segunda("13:00"))).toBe(true);
  });

  it("não, depois de fechar", () => {
    // 22:00 UTC = 19:00 em SP.
    expect(dentroDoExpediente(comercial, segunda("22:00"))).toBe(false);
  });

  it("o minuto de fechar já é fora", () => {
    // 21:00 UTC = 18:00 em SP, o fim exato da faixa.
    expect(dentroDoExpediente(comercial, segunda("21:00"))).toBe(false);
  });

  it("sem expediente configurado, atende sempre", () => {
    const domingoDeMadrugada = new Date("2026-08-16T06:00:00Z");
    expect(dentroDoExpediente(semExpediente, domingoDeMadrugada)).toBe(true);
  });

  it("faixa torta no banco não conta como aberto", () => {
    const torto = { expediente: { "1": [["oito", "dezoito"]] as [string, string][] }, fuso: SP };
    expect(dentroDoExpediente(torto, segunda("13:00"))).toBe(false);
  });
});

describe("o selo de espera", () => {
  it("não aparece na primeira hora", () => {
    // Abaixo de uma hora é o ritmo normal de um atendimento; um selo aqui
    // apareceria em toda conversa e não significaria nada.
    const agora = segunda("13:00");
    expect(descreverEspera(horasAntes(agora, 0.5), comercial, agora)).toBeNull();
  });

  it("aparece em atenção depois de uma hora", () => {
    const agora = segunda("13:00");
    expect(descreverEspera(horasAntes(agora, 2), comercial, agora)).toMatchObject({
      rotulo: "2h",
      nivel: "atencao",
    });
  });

  it("vira grave a partir de quatro horas", () => {
    const agora = segunda("17:00"); // 14:00 em SP, dentro do expediente
    expect(descreverEspera(horasAntes(agora, 5), comercial, agora)).toMatchObject({
      nivel: "grave",
    });
  });

  it("FORA do expediente, a espera aparece mas não vira alarme", () => {
    // O caso que motivou o módulo: conversa parada há seis horas às 22h de
    // São Paulo. O número é verdadeiro, mas ninguém falhou — a empresa
    // estava fechada. Vermelho aqui ensina a equipe a ignorar vermelho.
    const agora = segunda("01:00"); // 22:00 de domingo em SP
    expect(descreverEspera(horasAntes(agora, 6), comercial, agora)).toMatchObject({
      rotulo: "6h",
      nivel: "calma",
      foraDoExpediente: true,
    });
  });

  it("sem expediente configurado, o alarme volta a valer sempre", () => {
    const agora = segunda("01:00");
    expect(descreverEspera(horasAntes(agora, 6), semExpediente, agora)).toMatchObject({
      nivel: "grave",
      foraDoExpediente: false,
    });
  });

  it("a partir de um dia, o rótulo muda de unidade", () => {
    const agora = segunda("13:00");
    expect(descreverEspera(horasAntes(agora, 50), comercial, agora)?.rotulo).toBe("2d");
  });

  it("conversa sem relógio de espera não tem selo", () => {
    expect(descreverEspera(null, comercial, segunda("13:00"))).toBeNull();
  });

  it("data inválida não vira selo maluco", () => {
    expect(descreverEspera("nem data isso é", comercial, segunda("13:00"))).toBeNull();
  });
});
