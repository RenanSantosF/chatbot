import { Module } from '@nestjs/common';
import { WhatsappSenderService } from './whatsapp-sender.service';
import { WhatsappSettingsController } from './whatsapp-settings.controller';
import { WhatsappSettingsService } from './whatsapp-settings.service';

@Module({
  controllers: [WhatsappSettingsController],
  providers: [WhatsappSettingsService, WhatsappSenderService],
  exports: [WhatsappSenderService],
})
export class WhatsappModule {}
