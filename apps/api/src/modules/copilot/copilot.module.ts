import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiProviderModule } from '../ai/providers/ai-provider.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { InboxSettingsModule } from '../inbox-settings/inbox-settings.module';
import { QueuesModule } from '../queues/queues.module';
import { QuickRepliesModule } from '../quick-replies/quick-replies.module';
import { TagsModule } from '../tags/tags.module';
import { CopilotController } from './copilot.controller';
import { CopilotLeituraService } from './copilot-leitura.service';
import { CopilotService } from './copilot.service';

@Module({
  imports: [
    AiProviderModule,
    InboxSettingsModule,
    // As ações que o assistente propõe passam pelos serviços das telas —
    // mesmas validações, mesmas notas no histórico, mesmo tempo real.
    AiModule,
    ConversationsModule,
    QueuesModule,
    QuickRepliesModule,
    TagsModule,
  ],
  controllers: [CopilotController],
  providers: [CopilotService, CopilotLeituraService],
})
export class CopilotModule {}
