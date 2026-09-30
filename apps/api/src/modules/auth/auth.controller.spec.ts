import { AuthController } from './auth.controller';

/**
 * O tour guiado é marcado na CONTA: trocar de navegador ou de computador
 * não pode fazê-lo aparecer de novo.
 */
function montar(tourVistoEm: Date | null) {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    client: {
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 't1', name: 'Empresa', slug: 'empresa' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Renan',
          mustChangePassword: false,
          tourVistoEm,
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany,
      },
      billingAccount: { findFirst: jest.fn().mockResolvedValue(null) },
      retentionSettings: { findFirst: jest.fn().mockResolvedValue(null) },
    },
  };
  const controller = new AuthController(
    {} as never,
    prisma as never,
    { doTenant: jest.fn().mockResolvedValue(null) } as never,
    { status: jest.fn().mockResolvedValue({ bloqueado: false }) } as never,
    { registrar: jest.fn().mockResolvedValue(undefined) } as never,
  );
  const user = {
    userId: 'u1',
    tenantId: 't1',
    email: 'renan@x.com',
    role: 'OWNER',
  } as never;
  return { controller, user, updateMany };
}

describe('tour guiado por conta', () => {
  it('a sessão diz se a pessoa já viu o tour', async () => {
    const nunca = montar(null);
    expect((await nunca.controller.me(nunca.user)).user.tourVisto).toBe(false);

    const ja = montar(new Date());
    expect((await ja.controller.me(ja.user)).user.tourVisto).toBe(true);
  });

  it('marcar grava só a primeira vez, na conta de quem pediu', async () => {
    const { controller, user, updateMany } = montar(null);
    await controller.tourVisto(user);
    const [args] = updateMany.mock.calls[0] as [
      { where: unknown; data: { tourVistoEm: unknown } },
    ];
    expect(args.where).toEqual({ id: 'u1', tourVistoEm: null });
    expect(args.data.tourVistoEm).toBeInstanceOf(Date);
  });
});
