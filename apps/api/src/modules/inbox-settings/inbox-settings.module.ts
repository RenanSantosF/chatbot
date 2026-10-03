import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { AutoCloseService } from './auto-close.service';
import { InboxSettingsController } from './inbox-settings.controller';
import { InboxSettingsService } from './inbox-settings.service';

@Module({
  imports: [RealtimeModule],
  controllers: [InboxSettingsController],
  providers: [InboxSettingsService, AutoCloseService],
  exports: [InboxSettingsService],
})
export class InboxSettingsModule {}
