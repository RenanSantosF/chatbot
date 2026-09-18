import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarAgrupadorDeRajada } from "./agrupar-rajada";

/**
 * Duas garantias, e as duas importam pro histórico importado (F02):
 *
 * 1. Uma rajada de chamadas vira UMA execução, não uma por chamada — é o
 *    que evita reconsultar a lista a cada lote de um webhook disparando
 *    dezenas de vezes por segundo.
 * 2. A rajada, se nunca parar, ainda assim executa dentro do prazo
 *    máximo — sem isto, uma sincronização longa nunca atualizaria a tela
 *    até o fim inteiro dela.
 */
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("criarAgrupadorDeRajada", () => {
  it("uma chamada só dispara depois da janela passar", () => {
    const fn = vi.fn();
    const agrupador = criarAgrupadorDeRajada(fn, { janela: 100, prazoMaximo: 1000 });

    agrupador.disparar();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uma rajada dentro da janela vira uma execução só", () => {
    const fn = vi.fn();
    const agrupador = criarAgrupadorDeRajada(fn, { janela: 100, prazoMaximo: 1000 });

    agrupador.disparar();
    vi.advanceTimersByTime(50);
    agrupador.disparar();
    vi.advanceTimersByTime(50);
    agrupador.disparar();
    vi.advanceTimersByTime(50);
    // Ainda dentro da janela desde a última chamada — não disparou.
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uma rajada CONTÍNUA (sem pausa) ainda dispara no prazo máximo", () => {
    const fn = vi.fn();
    const agrupador = criarAgrupadorDeRajada(fn, { janela: 100, prazoMaximo: 500 });

    // Chama a cada 80ms — sempre antes da janela de 100ms fechar, então
    // sem o prazo máximo isto nunca dispararia sozinho.
    for (let i = 0; i < 10; i++) {
      agrupador.disparar();
      vi.advanceTimersByTime(80);
    }

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("depois do prazo máximo disparar, a rajada seguinte arma um novo ciclo", () => {
    const fn = vi.fn();
    const agrupador = criarAgrupadorDeRajada(fn, { janela: 100, prazoMaximo: 500 });

    for (let i = 0; i < 7; i++) {
      agrupador.disparar();
      vi.advanceTimersByTime(80);
    }
    expect(fn).toHaveBeenCalledTimes(1);

    // Nova rajada, depois do disparo do prazo máximo.
    agrupador.disparar();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("forcar() roda na hora e cancela o que estava agendado", () => {
    const fn = vi.fn();
    const agrupador = criarAgrupadorDeRajada(fn, { janela: 100, prazoMaximo: 1000 });

    agrupador.disparar();
    agrupador.forcar();
    expect(fn).toHaveBeenCalledTimes(1);

    // O timer da janela original não pode disparar de novo depois.
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancelar() desarma tudo sem rodar fn", () => {
    const fn = vi.fn();
    const agrupador = criarAgrupadorDeRajada(fn, { janela: 100, prazoMaximo: 1000 });

    agrupador.disparar();
    agrupador.cancelar();

    vi.advanceTimersByTime(2000);
    expect(fn).not.toHaveBeenCalled();
  });
});
