import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { CollectionModule } from '../collection/collection.module';
import { QueuesModule } from '../queues/queues.module';
import { RoutingModule } from '../routing/routing.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AiContextBuilder } from './ai-context-builder.service';
import { AiEngineService } from './ai-engine.service';
import { AiInstructionsController } from './ai-instructions.controller';
import { AiInstructionsService } from './ai-instructions.service';
import { AiSettingsController } from './ai-settings.controller';
import { AiSettingsService } from './ai-settings.service';
import { AiTestController } from './ai-test.controller';
import { AiProviderModule } from './providers/ai-provider.module';
import { AiToolsController } from './tools/ai-tools.controller';
import { AiToolsService } from './tools/ai-tools.service';

@Module({
  imports: [AiProviderModule, KnowledgeModule, RealtimeModule, QueuesModule, RoutingModule, CollectionModule],
  controllers: [AiSettingsController, AiInstructionsController, AiTestController, AiToolsController],
  providers: [AiContextBuilder, AiEngineService, AiSettingsService, AiInstructionsService, AiToolsService],
  exports: [AiEngineService],
})
export class AiModule {}
