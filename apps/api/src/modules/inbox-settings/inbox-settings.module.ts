import { Module } from '@nestjs/common';
import { InboxSettingsController } from './inbox-settings.controller';
import { InboxSettingsService } from './inbox-settings.service';

@Module({
  controllers: [InboxSettingsController],
  providers: [InboxSettingsService],
  exports: [InboxSettingsService],
})
export class InboxSettingsModule {}
