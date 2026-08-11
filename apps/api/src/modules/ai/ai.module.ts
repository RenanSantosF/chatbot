import { Module } from '@nestjs/common';
import { AiContextBuilder } from './ai-context-builder.service';
import { AiEngineService } from './ai-engine.service';
import { AiInstructionsController } from './ai-instructions.controller';
import { AiInstructionsService } from './ai-instructions.service';
import { AiSettingsController } from './ai-settings.controller';
import { AiSettingsService } from './ai-settings.service';
import { AiTestController } from './ai-test.controller';
import { AiProviderModule } from './providers/ai-provider.module';

@Module({
  imports: [AiProviderModule],
  controllers: [AiSettingsController, AiInstructionsController, AiTestController],
  providers: [AiContextBuilder, AiEngineService, AiSettingsService, AiInstructionsService],
  exports: [AiEngineService],
})
export class AiModule {}
