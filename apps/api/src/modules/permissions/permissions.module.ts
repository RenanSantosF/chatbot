import { Global, Module } from '@nestjs/common';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';

// Global porque o PermissionsGuard roda como guard de aplicação e precisa
// do service em qualquer módulo, sem cada um ter que importar este aqui.
@Global()
@Module({
  controllers: [PermissionsController],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
