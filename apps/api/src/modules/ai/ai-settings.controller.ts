import { Body, Controller, Get, Put } from '@nestjs/common';
import { RequiresPermission } from '../../common/auth/permission.decorator';
import { AiSettingsService } from './ai-settings.service';
import { AiUsageService } from './ai-usage.service';
import { UpdateAiSettingsDto } from './dto/update-ai-settings.dto';

@Controller('ai/settings')
export class AiSettingsController {
  constructor(
    private readonly aiSettingsService: AiSettingsService,
    private readonly aiUsage: AiUsageService,
  ) {}

  @Get()
  get() {
    return this.aiSettingsService.get();
  }

  /**
   * Quantas respostas automáticas já saíram este mês, e quantas o plano
   * inclui. Sem `ai.manage`: é informação de "como estamos indo", não uma
   * configuração — quem só olha o painel também quer saber por que a IA
   * parou de responder, se for o caso.
   */
  @Get('uso')
  uso() {
    return this.aiUsage.limite();
  }

  @Put()
  @RequiresPermission('ai.manage')
  update(@Body() dto: UpdateAiSettingsDto) {
    return this.aiSettingsService.update(dto);
  }
}
