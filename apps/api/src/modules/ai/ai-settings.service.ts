import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { UpdateAiSettingsDto } from './dto/update-ai-settings.dto';

@Injectable()
export class AiSettingsService {
  constructor(private readonly prisma: TenantPrismaService) {}

  /**
   * Todo tenant ganha AiSettings no registro (ver AuthService.register); o
   * upsert aqui é só uma rede de segurança pra tenants antigos de antes
   * desse modelo existir.
   */
  private async getRaw() {
    const existing = await this.prisma.db.aiSettings.findFirst();
    if (existing) {
      return existing;
    }
    return this.prisma.db.aiSettings.create({ data: { tenantId: this.prisma.tenantId } });
  }

  async get() {
    return this.getRaw();
  }

  async update(dto: UpdateAiSettingsDto) {
    const current = await this.getRaw();
    return this.prisma.db.aiSettings.update({
      where: { id: current.id },
      data: dto,
    });
  }
}
