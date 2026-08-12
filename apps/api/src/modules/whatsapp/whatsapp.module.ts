import { Module } from '@nestjs/common';
import { WhatsappMediaController } from './whatsapp-media.controller';
import { WhatsappMediaService } from './whatsapp-media.service';
import { WhatsappSenderService } from './whatsapp-sender.service';
import { WhatsappSettingsController } from './whatsapp-settings.controller';
import { WhatsappSettingsService } from './whatsapp-settings.service';

@Module({
  controllers: [WhatsappSettingsController, WhatsappMediaController],
  providers: [WhatsappSettingsService, WhatsappSenderService, WhatsappMediaService],
  exports: [WhatsappSenderService, WhatsappMediaService],
})
export class WhatsappModule {}
