import { Injectable } from '@nestjs/common';
import type { UserRole } from '../../../generated/prisma/client';
import { CacheCurto } from '../../common/cache/cache-curto';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  PERMISSION_DEFAULTS,
  type PermissionKey,
} from './permissions.constants';

/** Respostas do `can`, por empresa + papel + permissão (ver lá). */
const permissoesLembradas = new CacheCurto<boolean>(60_000);

const CONFIGURABLE_ROLES: Exclude<UserRole, 'OWNER'>[] = ['ADMIN', 'AGENT'];

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: TenantPrismaService) {}

  /** Matriz completa (padrão + overrides do tenant) pra montar a tela. */
  async matrix() {
    const overrides = await this.prisma.db.rolePermission.findMany();
    const byRole = new Map(
      overrides.map((row) => [`${row.role}:${row.key}`, row.allowed]),
    );

    return {
      catalog: PERMISSION_CATALOG,
      roles: CONFIGURABLE_ROLES.map((role) => ({
        role,
        permissions: Object.fromEntries(
          ALL_PERMISSION_KEYS.map((key) => [
            key,
            byRole.get(`${role}:${key}`) ?? PERMISSION_DEFAULTS[role][key],
          ]),
        ) as Record<PermissionKey, boolean>,
      })),
    };
  }

  async set(
    role: Exclude<UserRole, 'OWNER'>,
    key: PermissionKey,
    allowed: boolean,
  ) {
    await this.prisma.db.rolePermission.upsert({
      where: {
        tenantId_role_key: { tenantId: this.prisma.tenantId, role, key },
      },
      create: { tenantId: this.prisma.tenantId, role, key, allowed },
      update: { allowed },
    });
    permissoesLembradas.esquecer(`${this.prisma.tenantId}:`);
    return this.matrix();
  }

  /**
   * Checagem usada pelo guard. OWNER sempre passa: ele é a autoridade que
   * define as regras, então não pode ser barrado por elas.
   */
  async can(role: UserRole, key: PermissionKey): Promise<boolean> {
    if (role === 'OWNER') return true;

    // O guard pergunta isto em quase toda chamada, e a resposta só muda
    // quando alguém salva a tela de permissões (que esquece a empresa
    // inteira, abaixo em `set`).
    const chave = `${this.prisma.tenantId}:${role}:${key}`;
    const lembrado = permissoesLembradas.get(chave);
    if (lembrado !== undefined) return lembrado;

    const override = await this.prisma.db.rolePermission.findFirst({
      where: { role, key },
    });
    const pode = override?.allowed ?? PERMISSION_DEFAULTS[role][key] ?? false;
    permissoesLembradas.set(chave, pode);
    return pode;
  }
}
