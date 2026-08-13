import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { CustomersModule } from '../customers/customers.module';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [ConversationsModule, CustomersModule],
  controllers: [WhatsappWebhookController],
})
export class WhatsappWebhookModule {}
