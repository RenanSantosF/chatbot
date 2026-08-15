import { Module } from '@nestjs/common';
import { CanalService } from './canal/canal.service';
import { EmbeddedSignupController } from './embedded-signup.controller';
import { EmbeddedSignupService } from './embedded-signup.service';
import { WhatsappMediaController } from './whatsapp-media.controller';
import { WhatsappMediaService } from './whatsapp-media.service';
import { WhatsappSenderService } from './whatsapp-sender.service';
import { WhatsappSettingsController } from './whatsapp-settings.controller';
import { WhatsappSettingsService } from './whatsapp-settings.service';

@Module({
  controllers: [
    WhatsappSettingsController,
    WhatsappMediaController,
    EmbeddedSignupController,
  ],
  providers: [
    WhatsappSettingsService,
    WhatsappSenderService,
    WhatsappMediaService,
    EmbeddedSignupService,
    CanalService,
  ],
  // O `WhatsappSenderService` continua exportado porque a mídia ainda passa
  // por ele. Quem só manda texto, reação ou modelo deve pedir o
  // `CanalService` — é ele que respeita a escolha de provedor da empresa.
  exports: [CanalService, WhatsappSenderService, WhatsappMediaService],
})
export class WhatsappModule {}
