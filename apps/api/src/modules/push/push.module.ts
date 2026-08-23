import { Global, Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushService } from './push.service';

/**
 * Global porque quem avisa é o caminho de receber mensagem, que vive no
 * módulo de conversas — e importar um módulo inteiro pra usar um método de
 * "nada aqui lança" espalharia dependência sem ganho.
 */
@Global()
@Module({
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
