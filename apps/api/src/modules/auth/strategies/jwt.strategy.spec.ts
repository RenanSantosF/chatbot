import { JwtStrategy } from './jwt.strategy';

/**
 * Senha redefinida pelo e-mail derruba quem estava logado com a antiga —
 * quem pede isso pode estar desconfiando de que alguém entrou na conta.
 */
describe('sessões depois de redefinir a senha', () => {
  const antes = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'segredo-de-teste';
  });
  afterAll(() => {
    process.env.JWT_SECRET = antes;
  });

  const redefinidaEm = new Date('2026-10-01T12:00:00Z');
  const montar = () =>
    new JwtStrategy({
      client: {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u-redef',
            tenantId: 't1',
            role: 'OWNER',
            email: 'a@a.com',
            name: 'A',
            status: 'ACTIVE',
            sessoesValidasDesde: redefinidaEm,
          }),
        },
      },
    } as never);
  const emSegundos = (data: Date) => Math.floor(data.getTime() / 1000);

  it('o token de antes da redefinição não entra mais', async () => {
    await expect(
      montar().validate({
        sub: 'u-redef',
        tenantId: 't1',
        role: 'OWNER',
        iat: emSegundos(redefinidaEm) - 60,
      }),
    ).rejects.toThrow(/Sessão encerrada/);
  });

  it('o login feito com a senha nova entra', async () => {
    await expect(
      montar().validate({
        sub: 'u-redef',
        tenantId: 't1',
        role: 'OWNER',
        iat: emSegundos(redefinidaEm),
      }),
    ).resolves.toMatchObject({ userId: 'u-redef' });
  });

  it('e o token antigo não pega carona no cache do novo', async () => {
    const estrategia = montar();
    await estrategia.validate({
      sub: 'u-redef',
      tenantId: 't1',
      role: 'OWNER',
      iat: emSegundos(redefinidaEm) + 5,
    });
    await expect(
      estrategia.validate({
        sub: 'u-redef',
        tenantId: 't1',
        role: 'OWNER',
        iat: emSegundos(redefinidaEm) - 5,
      }),
    ).rejects.toThrow(/Sessão encerrada/);
  });
});
