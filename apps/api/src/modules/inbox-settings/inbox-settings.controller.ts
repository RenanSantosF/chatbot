import { Body, Controller, Get, Patch } from '@nestjs/common';
import { RequiresPermission } from '../../common/auth/permission.decorator';
import { UpdateInboxSettingsDto } from './dto/inbox-settings.dto';
import { InboxSettingsService } from './inbox-settings.service';

@Controller('inbox-settings')
export class InboxSettingsController {
  constructor(private readonly inboxSettingsService: InboxSettingsService) {}

  @Get()
  get() {
    return this.inboxSettingsService.get();
  }

  @Patch()
  @RequiresPermission('whatsapp.manage')
  update(@Body() dto: UpdateInboxSettingsDto) {
    return this.inboxSettingsService.update(dto);
  }
}
