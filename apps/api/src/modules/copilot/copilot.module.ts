import { Module } from '@nestjs/common';
import { AiProviderModule } from '../ai/providers/ai-provider.module';
import { InboxSettingsModule } from '../inbox-settings/inbox-settings.module';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';

@Module({
  imports: [AiProviderModule, InboxSettingsModule],
  controllers: [CopilotController],
  providers: [CopilotService],
})
export class CopilotModule {}
