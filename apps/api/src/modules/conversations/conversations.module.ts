import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CollectionModule } from '../collection/collection.module';
import { CustomersModule } from '../customers/customers.module';
import { InboxSettingsModule } from '../inbox-settings/inbox-settings.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RoutingModule } from '../routing/routing.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [
    RoutingModule,
    CustomersModule,
    RealtimeModule,
    AiModule,
    WhatsappModule,
    InboxSettingsModule,
    // A trava de escalonamento confere o que falta coletar antes de mandar
    // a conversa pra um humano (ver aplicarTravasDaIa).
    CollectionModule,
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
