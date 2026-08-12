import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Scope,
} from '@nestjs/common';
import type { CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../../modules/auth/auth.types';
import type { PermissionKey } from '../../modules/permissions/permissions.constants';
import { PermissionsService } from '../../modules/permissions/permissions.service';
import { PERMISSION_KEY } from './permission.decorator';

/**
 * Request-scoped porque o PermissionsService depende do TenantPrismaService,
 * que já é por requisição — a matriz de permissões é sempre a do tenant de
 * quem está chamando, nunca uma tabela global.
 */
@Injectable({ scope: Scope.REQUEST })
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role;
    if (!role || !(await this.permissions.can(role, required))) {
      throw new ForbiddenException(
        'Seu perfil não tem permissão para esta ação.',
      );
    }

    return true;
  }
}
