import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { VigiaDoWhatsappService } from './vigia-do-whatsapp.service';

/** Avisos ao dono que nascem fora de qualquer requisição. */
@Module({
  imports: [RealtimeModule],
  providers: [VigiaDoWhatsappService],
})
export class AvisosModule {}
