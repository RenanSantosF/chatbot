import { CacheCurto } from './cache-curto';

describe('CacheCurto', () => {
  afterEach(() => jest.useRealTimers());

  it('devolve o valor dentro da validade e esquece depois', () => {
    jest.useFakeTimers();
    const cache = new CacheCurto<number>(1000);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    jest.advanceTimersByTime(1001);
    expect(cache.get('a')).toBeUndefined();
  });

  it('esquece por prefixo — quem grava invalida na hora', () => {
    const cache = new CacheCurto<number>(60_000);
    cache.set('t1:ADMIN:x', 1);
    cache.set('t1:AGENT:x', 2);
    cache.set('t2:ADMIN:x', 3);
    cache.esquecer('t1:');
    expect(cache.get('t1:ADMIN:x')).toBeUndefined();
    expect(cache.get('t1:AGENT:x')).toBeUndefined();
    expect(cache.get('t2:ADMIN:x')).toBe(3);
  });

  it('não passa do máximo de entradas', () => {
    const cache = new CacheCurto<number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });
});
