import { createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { RedefinicaoDeSenhaService } from './redefinicao-de-senha.service';

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

function montar(
  opcoes: {
    usuario?: Record<string, unknown> | null;
    pedidoRecente?: boolean;
    pedido?: Record<string, unknown> | null;
    marcouComoUsado?: number;
  } = {},
) {
  const usuario =
    opcoes.usuario === undefined
      ? {
          id: 'u1',
          name: 'Renan Ferreira',
          email: 'renan@empresa.com',
          status: 'ACTIVE',
          tenant: { status: 'ACTIVE' },
        }
      : opcoes.usuario;
  const redefinicaoDeSenha = {
    findFirst: jest
      .fn()
      .mockResolvedValue(opcoes.pedidoRecente ? { id: 'r0' } : null),
    findUnique: jest.fn().mockResolvedValue(opcoes.pedido ?? null),
    updateMany: jest
      .fn()
      .mockResolvedValue({ count: opcoes.marcouComoUsado ?? 1 }),
    create: jest.fn().mockResolvedValue({}),
  };
  const user = {
    findFirst: jest.fn().mockResolvedValue(usuario),
    update: jest.fn().mockResolvedValue({}),
  };
  const prisma = {
    client: {
      user,
      redefinicaoDeSenha,
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    },
  };
  const email = { enviar: jest.fn().mockResolvedValue(true) };
  const realtime = { derrubarPessoa: jest.fn() };
  return {
    service: new RedefinicaoDeSenhaService(
      prisma as never,
      email as never,
      realtime as never,
    ),
    prisma,
    email,
    realtime,
  };
}

describe('pedir a redefinição', () => {
  it('manda o link por e-mail e guarda só o hash do token', async () => {
    const { service, email, prisma } = montar();

    await service.pedir('Renan@Empresa.com ');

    const [[mensagem]] = email.enviar.mock.calls as [
      [{ para: string; texto: string }],
    ];
    expect(mensagem.para).toBe('renan@empresa.com');
    const token = /token=([\w-]+)/.exec(mensagem.texto)?.[1] ?? '';
    expect(token.length).toBeGreaterThan(30);

    const [[{ data }]] = prisma.client.redefinicaoDeSenha.create.mock.calls as [
      [{ data: { tokenHash: string; expiraEm: Date } }],
    ];
    expect(data.tokenHash).toBe(hash(token));
    expect(data.tokenHash).not.toContain(token);
    // Vale 30 minutos.
    expect(data.expiraEm.getTime() - Date.now()).toBeGreaterThan(
      29 * 60 * 1000,
    );
    expect(data.expiraEm.getTime() - Date.now()).toBeLessThanOrEqual(
      30 * 60 * 1000,
    );
  });

  it('um link novo invalida os anteriores', async () => {
    const { service, prisma } = montar();

    await service.pedir('renan@empresa.com');

    expect(prisma.client.redefinicaoDeSenha.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', usadoEm: null },
      data: { usadoEm: expect.any(Date) as Date },
    });
  });

  it('e-mail sem conta: não manda nada e não conta isso a ninguém', async () => {
    const { service, email } = montar({ usuario: null });

    await expect(service.pedir('ninguem@x.com')).resolves.toBeUndefined();
    expect(email.enviar).not.toHaveBeenCalled();
  });

  it('acesso desligado não recebe link', async () => {
    const { service, email } = montar({
      usuario: {
        id: 'u1',
        name: 'X',
        email: 'x@x.com',
        status: 'DISABLED',
        tenant: { status: 'ACTIVE' },
      },
    });

    await service.pedir('x@x.com');
    expect(email.enviar).not.toHaveBeenCalled();
  });

  it('clicar várias vezes em um minuto manda um e-mail só', async () => {
    const { service, email } = montar({ pedidoRecente: true });

    await service.pedir('renan@empresa.com');
    expect(email.enviar).not.toHaveBeenCalled();
  });
});

describe('redefinir com o link', () => {
  const valido = {
    id: 'r1',
    userId: 'u1',
    expiraEm: new Date(Date.now() + 10 * 60 * 1000),
    usadoEm: null,
    user: { status: 'ACTIVE' },
  };

  it('troca a senha e derruba as sessões antigas', async () => {
    const { service, prisma } = montar({ pedido: valido });

    await service.redefinir('token-do-email-123', 'senha-nova-123');

    expect(prisma.client.redefinicaoDeSenha.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: hash('token-do-email-123') },
      }),
    );
    const [[{ data }]] = prisma.client.user.update.mock.calls as [
      [
        {
          data: {
            passwordHash: string;
            sessoesValidasDesde: Date;
            mustChangePassword: boolean;
          };
        },
      ],
    ];
    expect(await bcrypt.compare('senha-nova-123', data.passwordHash)).toBe(
      true,
    );
    expect(data.sessoesValidasDesde).toBeInstanceOf(Date);
    expect(data.mustChangePassword).toBe(false);
  });

  it('quem estava com o painel aberto sai do tempo real', async () => {
    const { service, realtime } = montar({ pedido: valido });

    await service.redefinir('token-do-email-123', 'senha-nova-123');

    expect(realtime.derrubarPessoa).toHaveBeenCalledWith('u1');
  });

  it('link expirado não serve', async () => {
    const { service, prisma } = montar({
      pedido: { ...valido, expiraEm: new Date(Date.now() - 1000) },
    });

    await expect(
      service.redefinir('token-do-email-123', 'senha-nova-123'),
    ).rejects.toThrow(/expirou ou já foi usado/);
    expect(prisma.client.user.update).not.toHaveBeenCalled();
  });

  it('link já usado não serve', async () => {
    const { service } = montar({ pedido: { ...valido, usadoEm: new Date() } });

    await expect(
      service.redefinir('token-do-email-123', 'senha-nova-123'),
    ).rejects.toThrow(/expirou ou já foi usado/);
  });

  it('duas abas confirmando o mesmo link: só a primeira troca a senha', async () => {
    const { service, prisma } = montar({ pedido: valido, marcouComoUsado: 0 });

    await expect(
      service.redefinir('token-do-email-123', 'senha-nova-123'),
    ).rejects.toThrow(/já foi usado/);
    expect(prisma.client.user.update).not.toHaveBeenCalled();
  });

  it('a tela pergunta antes se o link ainda vale', async () => {
    expect(
      await montar({ pedido: valido }).service.conferir('t-123456789'),
    ).toEqual({
      valido: true,
    });
    expect(
      await montar({ pedido: null }).service.conferir('t-123456789'),
    ).toEqual({
      valido: false,
    });
  });
});
