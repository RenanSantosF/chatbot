import { Body, Controller, Delete, Get, Post, Put } from '@nestjs/common';
import { RequiresPermission } from '../../common/auth/permission.decorator';
import { UpdateWhatsAppSettingsDto } from './dto/update-whatsapp-settings.dto';
import { WhatsappSettingsService } from './whatsapp-settings.service';

@Controller('whatsapp/settings')
export class WhatsappSettingsController {
  constructor(
    private readonly whatsappSettingsService: WhatsappSettingsService,
  ) {}

  @Get()
  get() {
    return this.whatsappSettingsService.get();
  }

  @Put()
  @RequiresPermission('whatsapp.manage')
  update(@Body() dto: UpdateWhatsAppSettingsDto) {
    return this.whatsappSettingsService.update(dto);
  }

  @Delete()
  @RequiresPermission('whatsapp.manage')
  disconnect() {
    return this.whatsappSettingsService.disconnect();
  }

  @Post('subscribe')
  @RequiresPermission('whatsapp.manage')
  subscribeApp() {
    return this.whatsappSettingsService.subscribeApp();
  }
}
