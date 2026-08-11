import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CustomersModule } from '../customers/customers.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [CustomersModule, RealtimeModule, AiModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
