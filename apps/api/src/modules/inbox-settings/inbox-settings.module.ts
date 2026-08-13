import { Module } from '@nestjs/common';
import { AutoCloseService } from './auto-close.service';
import { InboxSettingsController } from './inbox-settings.controller';
import { InboxSettingsService } from './inbox-settings.service';

@Module({
  controllers: [InboxSettingsController],
  providers: [InboxSettingsService, AutoCloseService],
  exports: [InboxSettingsService],
})
export class InboxSettingsModule {}
