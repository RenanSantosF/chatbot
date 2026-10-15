import { custoEmDolar } from './preco-do-modelo';

describe('custoEmDolar', () => {
  it('calcula pelo preço público do gemini-3.1-flash-lite', () => {
    // Preços de referência: US$0,25 / 1M tokens de entrada,
    // US$1,50 / 1M de saída.
    expect(custoEmDolar(1_000_000, 0)).toBeCloseTo(0.25);
    expect(custoEmDolar(0, 1_000_000)).toBeCloseTo(1.5);
  });

  it('uma resposta típica custa uma fração de centavo de dólar', () => {
    // ~2500 tokens de entrada, ~120 de saída — o caso comum descrito em
    // AiUsageService.
    expect(custoEmDolar(2500, 120)).toBeLessThan(0.001);
  });

  it('a entrada que veio do cache sai a um décimo do preço', () => {
    expect(custoEmDolar(1_000_000, 0, 1_000_000)).toBeCloseTo(0.025);
    expect(custoEmDolar(1_000_000, 0, 600_000)).toBeCloseTo(0.1 + 0.015);
    // Cache maior que a entrada (dado incoerente) não vira custo negativo.
    expect(custoEmDolar(1000, 0, 5000)).toBeGreaterThan(0);
  });
});
