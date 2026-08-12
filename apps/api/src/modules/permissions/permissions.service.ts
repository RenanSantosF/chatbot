import { Injectable } from '@nestjs/common';
import type { UserRole } from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  PERMISSION_DEFAULTS,
  type PermissionKey,
} from './permissions.constants';

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

  async set(role: Exclude<UserRole, 'OWNER'>, key: PermissionKey, allowed: boolean) {
    await this.prisma.db.rolePermission.upsert({
      where: { tenantId_role_key: { tenantId: this.prisma.tenantId, role, key } },
      create: { tenantId: this.prisma.tenantId, role, key, allowed },
      update: { allowed },
    });
    return this.matrix();
  }

  /**
   * Checagem usada pelo guard. OWNER sempre passa: ele é a autoridade que
   * define as regras, então não pode ser barrado por elas.
   */
  async can(role: UserRole, key: PermissionKey): Promise<boolean> {
    if (role === 'OWNER') return true;

    const override = await this.prisma.db.rolePermission.findFirst({
      where: { role, key },
    });
    return override?.allowed ?? PERMISSION_DEFAULTS[role][key] ?? false;
  }
}
