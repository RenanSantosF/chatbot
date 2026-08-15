import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { CustomersModule } from '../customers/customers.module';
import { WhatsappModule } from './whatsapp.module';
import { EvolutionWebhookController } from './canal/evolution/evolution-webhook.controller';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [ConversationsModule, CustomersModule, WhatsappModule],
  controllers: [WhatsappWebhookController, EvolutionWebhookController],
})
export class WhatsappWebhookModule {}
