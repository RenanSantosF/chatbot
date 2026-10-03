import { RealtimeGateway } from './realtime.gateway';

/**
 * Quem entra no tempo real.
 *
 * O token vale 7 dias. Conferir só a assinatura deixava quem foi
 * desativado recebendo as conversas ao vivo até ele vencer.
 */
function conectar(usuario: Record<string, unknown> & { id: string }) {
  // Um `sub` por teste: a conferência guarda o resultado por alguns
  // segundos, e um teste não pode aproveitar a resposta do anterior.
  const jwt = {
    verify: jest
      .fn()
      .mockReturnValue({ sub: usuario.id, tenantId: 't1', iat: 1_000 }),
  };
  const prisma = {
    client: { user: { findUnique: jest.fn().mockResolvedValue(usuario) } },
  };
  const gateway = new RealtimeGateway(jwt as never, prisma as never);
  const cliente = {
    handshake: { auth: { token: 'tok' } },
    join: jest.fn(),
    disconnect: jest.fn(),
  };
  return { gateway, cliente };
}

describe('conexão ao tempo real', () => {
  it('pessoa ativa entra nas salas da empresa e dela', async () => {
    const { gateway, cliente } = conectar({
      id: 'u1',
      tenantId: 't1',
      status: 'ACTIVE',
      role: 'AGENT',
      email: 'a@a.com',
      name: 'Ana',
      sessoesValidasDesde: null,
    });

    await gateway.handleConnection(cliente as never);

    expect(cliente.join).toHaveBeenCalledWith('tenant:t1');
    expect(cliente.join).toHaveBeenCalledWith('user:u1');
    expect(cliente.disconnect).not.toHaveBeenCalled();
  });

  it('desativada, com token ainda válido, é recusada', async () => {
    const { gateway, cliente } = conectar({
      id: 'u1-desativada',
      tenantId: 't1',
      status: 'DISABLED',
      sessoesValidasDesde: null,
    });

    await gateway.handleConnection(cliente as never);

    expect(cliente.join).not.toHaveBeenCalled();
    expect(cliente.disconnect).toHaveBeenCalledWith(true);
  });

  it('token de antes da senha redefinida é recusado', async () => {
    const { gateway, cliente } = conectar({
      id: 'u1-redefinida',
      tenantId: 't1',
      status: 'ACTIVE',
      sessoesValidasDesde: new Date(2_000_000),
    });

    await gateway.handleConnection(cliente as never);

    expect(cliente.disconnect).toHaveBeenCalledWith(true);
  });
});
