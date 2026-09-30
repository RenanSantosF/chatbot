import { pacotesConfigurados, quantidadePaga } from './pacotes';

describe('pacotes de respostas extras', () => {
  it('lê a lista da variável, em ordem de tamanho', () => {
    expect(
      pacotesConfigurados({
        STRIPE_PACOTES: '10000:price_c, 1000:price_a,3000:price_b',
      }),
    ).toEqual([
      { quantidade: 1000, precoId: 'price_a' },
      { quantidade: 3000, precoId: 'price_b' },
      { quantidade: 10000, precoId: 'price_c' },
    ]);
  });

  it('a variável antiga continua valendo como pacote de 1.000', () => {
    expect(
      pacotesConfigurados({ STRIPE_TOPUP_PRICE_ID: 'price_velho' }),
    ).toEqual([{ quantidade: 1000, precoId: 'price_velho' }]);
    // Se a nova já tem o de 1.000, a antiga não duplica.
    expect(
      pacotesConfigurados({
        STRIPE_PACOTES: '1000:price_novo',
        STRIPE_TOPUP_PRICE_ID: 'price_velho',
      }),
    ).toEqual([{ quantidade: 1000, precoId: 'price_novo' }]);
  });

  it('ignora itens mal escritos em vez de quebrar', () => {
    expect(
      pacotesConfigurados({
        STRIPE_PACOTES: 'mil:price_a,3000:prod_b,,5000:price_c',
      }),
    ).toEqual([{ quantidade: 5000, precoId: 'price_c' }]);
  });

  it('credita o que o checkout gravou; sem marca, o pacote antigo', () => {
    expect(quantidadePaga({ pacote: '3000' })).toBe(3000);
    expect(quantidadePaga({})).toBe(1000);
    expect(quantidadePaga(null)).toBe(1000);
    expect(quantidadePaga({ pacote: 'abc' })).toBe(1000);
  });
});
