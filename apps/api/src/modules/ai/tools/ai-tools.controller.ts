import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Roles } from '../../../common/auth/roles.decorator';
import { AiToolsService } from './ai-tools.service';
import { UpdateAiToolDto } from './dto/update-ai-tool.dto';

@Controller('ai/tools')
@Roles('OWNER', 'ADMIN')
export class AiToolsController {
  constructor(private readonly aiToolsService: AiToolsService) {}

  @Get()
  list() {
    return this.aiToolsService.listConfigured();
  }

  @Patch(':key')
  update(@Param('key') key: string, @Body() dto: UpdateAiToolDto) {
    return this.aiToolsService.setConfig(key, dto);
  }
}
