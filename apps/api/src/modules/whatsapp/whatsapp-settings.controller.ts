import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { Roles } from '../../common/auth/roles.decorator';
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
  @Roles('OWNER', 'ADMIN')
  update(@Body() dto: UpdateWhatsAppSettingsDto) {
    return this.whatsappSettingsService.update(dto);
  }

  @Delete()
  @Roles('OWNER', 'ADMIN')
  disconnect() {
    return this.whatsappSettingsService.disconnect();
  }
}
