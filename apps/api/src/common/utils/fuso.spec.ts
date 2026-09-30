import { cicloMensal, diaNoFuso, meiaNoite } from './fuso';

const SP = 'America/Sao_Paulo';

describe('ciclo mensal a partir do dia da assinatura', () => {
  it('antes do dia no mês: o ciclo começou no mês passado', () => {
    const { inicio, fim } = cicloMensal(
      15,
      SP,
      new Date('2026-09-10T15:00:00Z'),
    );
    expect(inicio.toISOString()).toBe('2026-08-15T03:00:00.000Z');
    expect(fim.toISOString()).toBe('2026-09-15T03:00:00.000Z');
  });

  it('no próprio dia, a partir da meia-noite local, já é o ciclo novo', () => {
    // 02:59 UTC do dia 15 ainda é 23:59 do dia 14 em São Paulo.
    expect(
      cicloMensal(15, SP, new Date('2026-09-15T02:59:00Z')).inicio.getTime(),
    ).toBe(new Date('2026-08-15T03:00:00Z').getTime());
    expect(
      cicloMensal(15, SP, new Date('2026-09-15T03:00:00Z')).inicio.getTime(),
    ).toBe(new Date('2026-09-15T03:00:00Z').getTime());
  });

  it('assinou dia 31: em fevereiro renova no último dia do mês', () => {
    const { inicio, fim } = cicloMensal(
      31,
      SP,
      new Date('2027-03-10T15:00:00Z'),
    );
    expect(inicio.toISOString()).toBe('2027-02-28T03:00:00.000Z');
    expect(fim.toISOString()).toBe('2027-03-31T03:00:00.000Z');
  });

  it('vira o ano', () => {
    const { inicio, fim } = cicloMensal(
      20,
      SP,
      new Date('2027-01-05T15:00:00Z'),
    );
    expect(inicio.toISOString()).toBe('2026-12-20T03:00:00.000Z');
    expect(fim.toISOString()).toBe('2027-01-20T03:00:00.000Z');
  });

  it('o dia é o do relógio da empresa', () => {
    expect(diaNoFuso(SP, new Date('2026-09-16T01:00:00Z'))).toBe(15);
    expect(meiaNoite(SP, new Date('2026-09-16T01:00:00Z')).toISOString()).toBe(
      '2026-09-15T03:00:00.000Z',
    );
  });
});
