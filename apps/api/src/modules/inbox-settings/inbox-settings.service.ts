import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { UpdateInboxSettingsDto } from './dto/inbox-settings.dto';

@Injectable()
export class InboxSettingsService {
  constructor(private readonly prisma: TenantPrismaService) {}

  /**
   * Cria com os padrões na primeira leitura em vez de semear no registro do
   * tenant: assim empresas criadas antes desta tela existirem também
   * ganham a configuração sem migração de dados.
   */
  async get() {
    const existing = await this.prisma.db.inboxSettings.findFirst();
    if (existing) return existing;
    return this.prisma.db.inboxSettings.create({
      data: { tenantId: this.prisma.tenantId },
    });
  }

  async update(dto: UpdateInboxSettingsDto) {
    const current = await this.get();
    return this.prisma.db.inboxSettings.update({
      where: { id: current.id },
      data: dto,
    });
  }
}
