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
});
