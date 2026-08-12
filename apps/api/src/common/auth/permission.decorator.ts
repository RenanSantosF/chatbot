import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '../../modules/permissions/permissions.constants';

export const PERMISSION_KEY = 'permission';

/**
 * Restringe a rota a quem tem a permissão configurada pelo dono. Mais fino
 * que @Roles: o papel diz quem a pessoa é, isto diz o que ela pode fazer —
 * e o dono muda isso pela tela de Permissões sem deploy.
 */
export const RequiresPermission = (permission: PermissionKey) =>
  SetMetadata(PERMISSION_KEY, permission);
