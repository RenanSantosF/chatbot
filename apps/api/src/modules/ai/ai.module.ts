import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { CollectionModule } from '../collection/collection.module';
import { InboxSettingsModule } from '../inbox-settings/inbox-settings.module';
import { QueuesModule } from '../queues/queues.module';
import { RoutingModule } from '../routing/routing.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AiContextBuilder } from './ai-context-builder.service';
import { AiEngineService } from './ai-engine.service';
import { TranscricaoService } from './transcricao.service';
import { AiInstructionsController } from './ai-instructions.controller';
import { AiInstructionsService } from './ai-instructions.service';
import { AiSettingsController } from './ai-settings.controller';
import { AiSettingsService } from './ai-settings.service';
import { AiTestController } from './ai-test.controller';
import { AiProviderModule } from './providers/ai-provider.module';
import { AiToolsController } from './tools/ai-tools.controller';
import { AiToolsService } from './tools/ai-tools.service';

@Module({
  imports: [AiProviderModule, KnowledgeModule, RealtimeModule, WhatsappModule, QueuesModule, RoutingModule, CollectionModule, InboxSettingsModule],
  controllers: [AiSettingsController, AiInstructionsController, AiTestController, AiToolsController],
  providers: [
    AiContextBuilder,
    AiEngineService,
    TranscricaoService,
    AiSettingsService,
    AiInstructionsService,
    AiToolsService,
  ],
  exports: [AiEngineService, TranscricaoService],
})
export class AiModule {}
