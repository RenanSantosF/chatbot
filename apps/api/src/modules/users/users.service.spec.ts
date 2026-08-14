import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';

/**
 * As travas da conta.
 *
 * Duas delas existem pra impedir que alguém se tranque pra fora da própria
 * empresa (o dono não é alvo, e ninguém edita a si mesmo pela tela de
 * equipe); a terceira impede que uma sessão aberta esquecida numa máquina
 * vire uma troca de senha — que trancaria o dono legítimo pra fora de
 * verdade.
 */
function servicoCom(usuario: Record<string, unknown> | null) {
  const atualizados: { id: string; data: Record<string, unknown> }[] = [];

  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      user: {
        findFirst: jest.fn().mockResolvedValue(usuario),
        update: jest
          .fn()
          .mockImplementation(
            (args: { where: { id: string }; data: unknown }) => {
              atualizados.push({
                id: args.where.id,
                data: args.data as Record<string, unknown>,
              });
              return { id: args.where.id };
            },
          ),
        create: jest.fn().mockResolvedValue({ id: 'novo' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    },
  };

  return { service: new UsersService(prisma as never), atualizados, prisma };
}

describe('edição de um colega (tela de equipe)', () => {
  it('não deixa mexer na própria conta por aqui', async () => {
    // Evita o dono se autodesativar por engano e ficar trancado pra fora.
    const { service } = servicoCom({ id: 'user-ana', role: 'ADMIN' });

    await expect(
      service.update('user-ana', { status: 'DISABLED' }, 'user-ana'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('o dono não é alvo: não dá pra rebaixar nem desativar', async () => {
    const { service } = servicoCom({ id: 'user-dono', role: 'OWNER' });

    await expect(
      service.update('user-dono', { role: 'AGENT' }, 'user-admin'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('colega de outra empresa não existe pra esta requisição', async () => {
    // O filtro por tenant é automático; o que chega aqui é o "não achei".
    const { service } = servicoCom(null);

    await expect(
      service.update('user-de-outra-empresa', { role: 'AGENT' }, 'user-admin'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('troca de papel de um colega comum passa', async () => {
    const { service, atualizados } = servicoCom({
      id: 'user-bruno',
      role: 'AGENT',
    });

    await service.update('user-bruno', { role: 'ADMIN' }, 'user-dono');

    expect(atualizados[0]).toMatchObject({
      id: 'user-bruno',
      data: { role: 'ADMIN' },
    });
  });
});

describe('edição da própria conta', () => {
  const senhaAtual = 'senha-antiga-123';
  let hash: string;

  beforeAll(async () => {
    hash = await bcrypt.hash(senhaAtual, 10);
  });

  it('trocar a senha exige a senha atual', async () => {
    // Sem isto, uma sessão aberta esquecida numa máquina vira troca de
    // senha, e o dono legítimo perde a conta.
    const { service } = servicoCom({ id: 'user-ana', passwordHash: hash });

    await expect(
      service.updateProfile('user-ana', {
        currentPassword: 'chute-errado',
        newPassword: 'senha-nova-456',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('com a senha atual certa, troca e guarda o hash — nunca o texto', async () => {
    const { service, atualizados } = servicoCom({
      id: 'user-ana',
      passwordHash: hash,
    });

    await service.updateProfile('user-ana', {
      currentPassword: senhaAtual,
      newPassword: 'senha-nova-456',
    });

    const gravado = atualizados[0].data.passwordHash as string;
    expect(gravado).not.toBe('senha-nova-456');
    await expect(bcrypt.compare('senha-nova-456', gravado)).resolves.toBe(true);
  });

  it('definir a própria senha encerra a pendência do primeiro acesso', async () => {
    const { service, atualizados } = servicoCom({
      id: 'user-ana',
      passwordHash: hash,
    });

    await service.updateProfile('user-ana', {
      currentPassword: senhaAtual,
      newPassword: 'senha-nova-456',
    });

    expect(atualizados[0].data.mustChangePassword).toBe(false);
  });

  it('mudar só o nome não pede senha nenhuma', async () => {
    const { service, atualizados } = servicoCom({ id: 'user-ana' });

    await service.updateProfile('user-ana', { name: 'Ana Souza' });

    expect(atualizados[0].data).toEqual({ name: 'Ana Souza' });
  });

  it('requisição sem nada pra mudar não escreve no banco', async () => {
    const { service, atualizados } = servicoCom({ id: 'user-ana' });

    await service.updateProfile('user-ana', {});

    expect(atualizados).toEqual([]);
  });
});
