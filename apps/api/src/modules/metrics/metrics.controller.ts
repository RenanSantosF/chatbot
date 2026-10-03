import { Controller, Get, Query } from '@nestjs/common';
import { RequiresPermission } from '../../common/auth/permission.decorator';
import { MetricsService } from './metrics.service';

// A tela de Permissões oferece "Ver relatórios e indicadores" e o padrão
// de atendente é NÃO. Sem esta linha a opção não valia nada: bastava o
// atendente abrir /dashboard pra ver faturamento de atendimento inteiro.
@RequiresPermission('metrics.view')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async overview(@Query('from') from?: string, @Query('to') to?: string) {
    const { fuso, ...periodo } = await this.metricsService.periodo(from, to);
    return this.metricsService.overview(periodo, fuso);
  }
}
