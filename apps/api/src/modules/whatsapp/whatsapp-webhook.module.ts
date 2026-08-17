import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { CustomersModule } from '../customers/customers.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WhatsappModule } from './whatsapp.module';
import { EvolutionWebhookController } from './canal/evolution/evolution-webhook.controller';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  // RealtimeModule está aqui porque o webhook da Evolution avisa a tela na
  // hora em que a sessão cai ou um QR code novo nasce. Sem ele o processo
  // NEM SOBE: o Nest resolve as dependências dos controladores na
  // inicialização, e um provider invisível derruba a aplicação inteira
  // antes da primeira requisição.
  imports: [ConversationsModule, CustomersModule, WhatsappModule, RealtimeModule],
  controllers: [WhatsappWebhookController, EvolutionWebhookController],
})
export class WhatsappWebhookModule {}
