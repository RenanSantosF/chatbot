import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../../generated/prisma/client';

export const ROLES_KEY = 'roles';

/** Restringe a rota a usuários com um dos roles informados (ex: @Roles('OWNER', 'ADMIN')). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
