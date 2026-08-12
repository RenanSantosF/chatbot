import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { RequiresPermission } from '../../common/auth/permission.decorator';
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
  @RequiresPermission('ai.manage')
  update(@Body() dto: UpdateAiSettingsDto) {
    return this.aiSettingsService.update(dto);
  }

  @Delete('api-key')
  @RequiresPermission('ai.manage')
  clearApiKey() {
    return this.aiSettingsService.clearApiKey();
  }
}
