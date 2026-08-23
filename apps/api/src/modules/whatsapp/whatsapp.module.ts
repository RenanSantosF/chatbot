import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { CanalService } from './canal/canal.service';
import { EvolutionCanal } from './canal/evolution/evolution.canal';
import { EvolutionController } from './canal/evolution/evolution.controller';
import { EvolutionService } from './canal/evolution/evolution.service';
import { EmbeddedSignupController } from './embedded-signup.controller';
import { EmbeddedSignupService } from './embedded-signup.service';
import { WhatsappMediaController } from './whatsapp-media.controller';
import { WhatsappMediaService } from './whatsapp-media.service';
import { EstadoDoCanalService } from './canal/estado-do-canal.service';
import { WhatsappSenderService } from './whatsapp-sender.service';
import { WhatsappSettingsController } from './whatsapp-settings.controller';
import { WhatsappSettingsService } from './whatsapp-settings.service';

@Module({
  // A agenda do aparelho vira cliente no painel — ver `importarAgenda`.
  imports: [CustomersModule],
  controllers: [
    WhatsappSettingsController,
    WhatsappMediaController,
    EmbeddedSignupController,
    EvolutionController,
  ],
  providers: [
    WhatsappSettingsService,
    WhatsappSenderService,
    WhatsappMediaService,
    EstadoDoCanalService,
    EmbeddedSignupService,
    CanalService,
    EvolutionCanal,
    EvolutionService,
  ],
  // O `WhatsappSenderService` continua exportado porque a mídia ainda passa
  // por ele. Quem só manda texto, reação ou modelo deve pedir o
  // `CanalService` — é ele que respeita a escolha de provedor da empresa.
  exports: [
    CanalService,
    // Exportado por causa do webhook da Evolution: é dele que sai o nome
    // do grupo, que a mensagem não traz. Sem exportar, o Nest não sobe —
    // o controlador do webhook vive noutro módulo (ver
    // WhatsappWebhookModule), e o app.module.spec pega isso na hora.
    EvolutionCanal,
    WhatsappSenderService,
    WhatsappMediaService,
    EstadoDoCanalService,
  ],
})
export class WhatsappModule {}
