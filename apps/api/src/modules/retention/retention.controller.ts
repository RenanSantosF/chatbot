import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Roles } from '../../common/auth/roles.decorator';
import { RolesGuard } from '../../common/auth/roles.guard';
import { RetentionService } from './retention.service';

class UpdateRetentionDto {
  /** Nulo apaga o prazo e volta a guardar pra sempre. */
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(3650)
  keepMessagesDays?: number | null;

  @IsOptional()
  @IsBoolean()
  autoPurgeOnFull?: boolean;
}

/**
 * Retenção é decisão de quem responde pela empresa, não de quem atende —
 * por isso só dono e admin chegam aqui.
 */
@Controller('retention')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('OWNER', 'ADMIN')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get()
  async get() {
    const [settings, billing, usage] = await Promise.all([
      this.retention.getSettings(),
      this.retention.getBilling(),
      this.retention.measureUsage(),
    ]);
    return {
      settings,
      billing: {
        planLabel: billing.planLabel,
        quotaBytes: Number(billing.quotaBytes),
      },
      usage,
    };
  }

  @Patch()
  update(@Body() dto: UpdateRetentionDto) {
    return this.retention.updateSettings(dto);
  }

  @Post('purge')
  purge() {
    return this.retention.purgeNow();
  }
}
