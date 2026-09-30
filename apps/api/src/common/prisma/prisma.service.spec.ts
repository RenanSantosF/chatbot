import { tamanhoDoPool } from './prisma.service';

describe('tamanho do pool de conexões', () => {
  it('padrão de 5 — cabe no pooler gratuito junto com a Evolution', () => {
    expect(tamanhoDoPool('postgresql://u:s@h:5432/db')).toBe(5);
  });

  it('respeita o connection_limit da URL', () => {
    expect(tamanhoDoPool('postgresql://u:s@h:5432/db?connection_limit=3')).toBe(
      3,
    );
  });

  it('DATABASE_POOL_MAX manda sobre a URL', () => {
    expect(
      tamanhoDoPool('postgresql://u:s@h:5432/db?connection_limit=3', '7'),
    ).toBe(7);
  });

  it('valor inválido cai no padrão', () => {
    expect(tamanhoDoPool('não é url', 'abc')).toBe(5);
  });
});
