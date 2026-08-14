import { PermissionsService } from './permissions.service';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_DEFAULTS,
} from './permissions.constants';

/**
 * Quem pode o quê.
 *
 * Duas regras que não podem quebrar em direções opostas: o dono nunca é
 * barrado (senão ele se tranca pra fora da própria empresa) e o que o dono
 * desligou fica desligado (senão a tela de Permissões vira decoração).
 */
function servicoCom(
  overrides: { role: string; key: string; allowed: boolean }[],
) {
  const prisma = {
    tenantId: 'tenant-teste',
    db: {
      rolePermission: {
        findMany: jest.fn().mockResolvedValue(overrides),
        findFirst: jest
          .fn()
          .mockImplementation(
            (args: { where: { role: string; key: string } }) =>
              overrides.find(
                (o) => o.role === args.where.role && o.key === args.where.key,
              ),
          ),
        upsert: jest.fn().mockResolvedValue({}),
      },
    },
  };

  return { service: new PermissionsService(prisma as never), prisma };
}

describe('o dono passa por cima de tudo', () => {
  it('permite mesmo sem nenhum registro', async () => {
    const { service } = servicoCom([]);
    await expect(service.can('OWNER', 'team.manage')).resolves.toBe(true);
  });

  it('permite mesmo com um bloqueio salvo no banco', async () => {
    // Um OWNER barrado por uma linha de RolePermission é um dono sem acesso
    // à própria empresa — e sem ninguém pra desfazer.
    const { service } = servicoCom([
      { role: 'OWNER', key: 'team.manage', allowed: false },
    ]);
    await expect(service.can('OWNER', 'team.manage')).resolves.toBe(true);
  });

  it('nem consulta o banco pra decidir', async () => {
    const { service, prisma } = servicoCom([]);
    await service.can('OWNER', 'ai.manage');
    expect(prisma.db.rolePermission.findFirst).not.toHaveBeenCalled();
  });
});

describe('padrões de fábrica', () => {
  it('admin nasce com tudo', async () => {
    const { service } = servicoCom([]);
    for (const key of ALL_PERMISSION_KEYS) {
      await expect(service.can('ADMIN', key)).resolves.toBe(true);
    }
  });

  it('atendente atende, mas não configura', async () => {
    const { service } = servicoCom([]);
    await expect(service.can('AGENT', 'conversations.send')).resolves.toBe(
      true,
    );
    await expect(service.can('AGENT', 'conversations.assign')).resolves.toBe(
      true,
    );
    await expect(service.can('AGENT', 'ai.manage')).resolves.toBe(false);
    await expect(service.can('AGENT', 'team.manage')).resolves.toBe(false);
    await expect(service.can('AGENT', 'whatsapp.manage')).resolves.toBe(false);
  });

  it('relatório é fechado pro atendente por padrão', async () => {
    // É o único item de "Clientes e dados" que nasce negado; a lista de
    // clientes ele precisa pra atender.
    const { service } = servicoCom([]);
    await expect(service.can('AGENT', 'metrics.view')).resolves.toBe(false);
    await expect(service.can('AGENT', 'customers.view')).resolves.toBe(true);
  });

  it('todo item do catálogo tem padrão declarado nos dois papéis', () => {
    // Sem isto, uma chave nova entra no catálogo, aparece na tela e cai no
    // `?? false` silencioso — o dono liga a permissão e nada acontece.
    for (const key of ALL_PERMISSION_KEYS) {
      expect(typeof PERMISSION_DEFAULTS.ADMIN[key]).toBe('boolean');
      expect(typeof PERMISSION_DEFAULTS.AGENT[key]).toBe('boolean');
    }
  });
});

describe('ajustes do dono', () => {
  it('o que ele desligou fica desligado', async () => {
    const { service } = servicoCom([
      { role: 'AGENT', key: 'conversations.send', allowed: false },
    ]);
    await expect(service.can('AGENT', 'conversations.send')).resolves.toBe(
      false,
    );
  });

  it('o que ele ligou vale mesmo contra o padrão', async () => {
    const { service } = servicoCom([
      { role: 'AGENT', key: 'metrics.view', allowed: true },
    ]);
    await expect(service.can('AGENT', 'metrics.view')).resolves.toBe(true);
  });

  it('o ajuste de um papel não vaza pro outro', async () => {
    const { service } = servicoCom([
      { role: 'AGENT', key: 'ai.manage', allowed: true },
    ]);
    await expect(service.can('AGENT', 'ai.manage')).resolves.toBe(true);
    await expect(service.can('ADMIN', 'ai.manage')).resolves.toBe(true);
  });
});

describe('matriz da tela', () => {
  it('traz os dois papéis configuráveis, nunca o dono', async () => {
    const { service } = servicoCom([]);
    const matriz = await service.matrix();

    expect(matriz.roles.map((r) => r.role)).toEqual(['ADMIN', 'AGENT']);
  });

  it('mistura padrão e ajuste na mesma linha', async () => {
    const { service } = servicoCom([
      { role: 'AGENT', key: 'conversations.send', allowed: false },
    ]);
    const matriz = await service.matrix();
    const agente = matriz.roles.find((r) => r.role === 'AGENT');

    expect(agente?.permissions['conversations.send']).toBe(false);
    expect(agente?.permissions['conversations.resolve']).toBe(true);
  });

  it('devolve todas as chaves do catálogo, sem buraco', async () => {
    const { service } = servicoCom([]);
    const matriz = await service.matrix();

    for (const papel of matriz.roles) {
      expect(Object.keys(papel.permissions).sort()).toEqual(
        [...ALL_PERMISSION_KEYS].sort(),
      );
    }
  });
});
