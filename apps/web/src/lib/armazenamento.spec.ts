import { describe, expect, it } from "vitest";
import { avisoDeArmazenamento, tamanhoLegivel } from "./armazenamento";

const GB = 1024 ** 3;

describe("armazenamento", () => {
  it("tamanho legível em português", () => {
    expect(tamanhoLegivel(512)).toBe("512 B");
    expect(tamanhoLegivel(1.5 * 1024 * 1024)).toBe("1,5 MB");
    expect(tamanhoLegivel(20 * GB)).toBe("20 GB");
    expect(tamanhoLegivel(2.5 * GB)).toBe("2,5 GB");
  });

  it("abaixo de 90%, nenhum aviso", () => {
    expect(avisoDeArmazenamento({ usadoBytes: 17 * GB, cotaBytes: 20 * GB, limpezaAutomatica: false })).toBeNull();
  });

  it("a partir de 90%, avisa — e diz o que vai acontecer ao encher", () => {
    const comLimpeza = avisoDeArmazenamento({ usadoBytes: 18.5 * GB, cotaBytes: 20 * GB, limpezaAutomatica: true });
    expect(comLimpeza?.titulo).toBe("Armazenamento em 92%");
    expect(comLimpeza?.detalhe).toMatch(/mais antigas são apagadas automaticamente/);

    const semLimpeza = avisoDeArmazenamento({ usadoBytes: 18.5 * GB, cotaBytes: 20 * GB, limpezaAutomatica: false });
    expect(semLimpeza?.detalhe).toMatch(/ligue a limpeza automática/);
  });

  it("cheio", () => {
    const aviso = avisoDeArmazenamento({ usadoBytes: 21 * GB, cotaBytes: 20 * GB, limpezaAutomatica: false });
    expect(aviso?.cheio).toBe(true);
    expect(aviso?.porcento).toBe(100);
  });
});
