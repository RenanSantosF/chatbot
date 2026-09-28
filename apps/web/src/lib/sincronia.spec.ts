import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarSincronia } from "./sincronia";

/**
 * O aviso de "Sincronizando" depois que a conexão volta.
 *
 * O que dói errar aqui: aceso a cada abertura do painel (ruído que ensina
 * a ignorar o aviso), apagado antes de a lista chegar (diz que está em
 * dia quando não está), ou preso aceso pra sempre numa tela que não
 * recarrega nada.
 */
const OPCOES = { semTrabalho: 1200, minimo: 700 };

function montar() {
  const estados: boolean[] = [];
  const sincronia = criarSincronia((aceso) => estados.push(aceso), OPCOES);
  const aceso = () => estados.at(-1) ?? false;
  return { sincronia, estados, aceso };
}

/** Uma promessa que o teste resolve (ou rejeita) quando quiser. */
function trabalhoControlado() {
  let resolver!: () => void;
  let rejeitar!: (erro: Error) => void;
  const promessa = new Promise<void>((ok, falha) => {
    resolver = ok;
    rejeitar = falha;
  });
  return { promessa, resolver, rejeitar };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("criarSincronia", () => {
  it("a primeira conexão da aba não acende nada", async () => {
    const { sincronia, estados } = montar();

    sincronia.voltou();
    sincronia.registrar(Promise.resolve());
    await vi.advanceTimersByTimeAsync(5000);

    expect(estados).toEqual([]);
  });

  it("reconexão acende, e sem trabalho nenhum apaga sozinha", async () => {
    const { sincronia, aceso } = montar();

    sincronia.caiu();
    sincronia.voltou();
    expect(aceso()).toBe(true);

    await vi.advanceTimersByTimeAsync(OPCOES.semTrabalho);
    expect(aceso()).toBe(false);
  });

  it("fica aceso enquanto a tela ainda está recarregando, mesmo depois do prazo sem trabalho", async () => {
    const { sincronia, aceso } = montar();
    const lista = trabalhoControlado();

    sincronia.caiu();
    sincronia.voltou();
    sincronia.registrar(lista.promessa);

    await vi.advanceTimersByTimeAsync(OPCOES.semTrabalho * 3);
    expect(aceso()).toBe(true);

    lista.resolver();
    await vi.advanceTimersByTimeAsync(0);
    expect(aceso()).toBe(false);
  });

  it("trabalho rápido ainda deixa o aviso aceso pelo tempo mínimo", async () => {
    const { sincronia, aceso } = montar();

    sincronia.caiu();
    sincronia.voltou();
    sincronia.registrar(Promise.resolve());

    await vi.advanceTimersByTimeAsync(OPCOES.minimo - 100);
    expect(aceso()).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(aceso()).toBe(false);
  });

  it("funciona com a tela registrando ANTES do aviso de volta (ordem dos ouvintes)", async () => {
    const { sincronia, aceso } = montar();
    const lista = trabalhoControlado();

    sincronia.caiu();
    sincronia.registrar(lista.promessa);
    sincronia.voltou();
    expect(aceso()).toBe(true);

    await vi.advanceTimersByTimeAsync(OPCOES.semTrabalho * 2);
    expect(aceso()).toBe(true);

    lista.resolver();
    await vi.advanceTimersByTimeAsync(0);
    expect(aceso()).toBe(false);
  });

  it("trabalho que falha também apaga o aviso", async () => {
    const { sincronia, aceso } = montar();
    const lista = trabalhoControlado();

    sincronia.caiu();
    sincronia.voltou();
    sincronia.registrar(lista.promessa);
    lista.rejeitar(new Error("rede"));

    await vi.advanceTimersByTimeAsync(OPCOES.minimo);
    expect(aceso()).toBe(false);
  });

  it("uma queda no meio da sincronização não se perde", async () => {
    const { sincronia, aceso } = montar();
    const primeira = trabalhoControlado();

    sincronia.caiu();
    sincronia.voltou();
    sincronia.registrar(primeira.promessa);

    // Caiu de novo antes de a primeira recarga terminar.
    sincronia.caiu();
    primeira.resolver();
    await vi.advanceTimersByTimeAsync(OPCOES.semTrabalho * 2);
    expect(aceso()).toBe(false);

    // A volta seguinte precisa acender de novo.
    sincronia.voltou();
    expect(aceso()).toBe(true);
  });
});
