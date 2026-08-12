import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [ConversationsModule],
  controllers: [WhatsappWebhookController],
})
export class WhatsappWebhookModule {}
