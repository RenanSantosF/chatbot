import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { BillingGuard } from './billing.guard';

function montarContexto(): ExecutionContext {
  return {
    getHandler: () => ({}) as never,
    getClass: () => ({}) as never,
    switchToHttp: () => ({
      getRequest: () => ({ user: { userId: 'user-1' } }),
    }),
  } as unknown as ExecutionContext;
}

function montarGuard(bloqueado: boolean) {
  const reflector = { getAllAndOverride: () => undefined };
  const billing = { status: jest.fn().mockResolvedValue({ bloqueado }) };
  return new BillingGuard(reflector as never, billing as never);
}

describe('BillingGuard', () => {
  it('bloqueia normalmente quem não tem assinatura', async () => {
    const guard = montarGuard(true);

    await expect(guard.canActivate(montarContexto())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('libera quem está em dia', async () => {
    const guard = montarGuard(false);

    await expect(guard.canActivate(montarContexto())).resolves.toBe(true);
  });
});
