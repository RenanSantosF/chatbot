import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { Roles } from '../../common/auth/roles.decorator';
import { AiSettingsService } from './ai-settings.service';
import { UpdateAiSettingsDto } from './dto/update-ai-settings.dto';

@Controller('ai/settings')
export class AiSettingsController {
  constructor(private readonly aiSettingsService: AiSettingsService) {}

  @Get()
  get() {
    return this.aiSettingsService.get();
  }

  @Put()
  @Roles('OWNER', 'ADMIN')
  update(@Body() dto: UpdateAiSettingsDto) {
    return this.aiSettingsService.update(dto);
  }

  @Delete('api-key')
  @Roles('OWNER', 'ADMIN')
  clearApiKey() {
    return this.aiSettingsService.clearApiKey();
  }
}
