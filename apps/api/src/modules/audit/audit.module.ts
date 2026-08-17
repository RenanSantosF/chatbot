import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Global porque quase todo módulo de negócio tem uma ação que precisa ir
 * pro registro — conversas, equipe, configurações, WhatsApp. Obrigar cada
 * um a importar este módulo só produziria ruído, e o serviço não guarda
 * estado que justifique instância separada por módulo.
 *
 * É o mesmo argumento do módulo de permissões, que já é global aqui.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
