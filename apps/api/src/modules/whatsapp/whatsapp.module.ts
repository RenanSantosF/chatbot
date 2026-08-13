import { Module } from '@nestjs/common';
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
  ],
  exports: [WhatsappSenderService, WhatsappMediaService],
})
export class WhatsappModule {}
