import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Global porque anexo aparece em vários pontos (webhook, mídia, retenção)
 * e importar o módulo em cada um deles só produziria ruído — o serviço não
 * tem estado por requisição.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
