import { Injectable } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { UpdateAiSettingsDto } from './dto/update-ai-settings.dto';

@Injectable()
export class AiSettingsService {
  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * A chave criptografada nunca sai desse service — a resposta pública só
   * diz se tem chave configurada e os últimos 4 caracteres, pra o dono
   * confirmar qual chave está ativa sem reexibir o valor inteiro.
   */
  private toPublic<T extends { apiKeyEncrypted: string | null }>(settings: T) {
    const { apiKeyEncrypted, ...rest } = settings;
    return {
      ...rest,
      hasApiKey: Boolean(apiKeyEncrypted),
      apiKeyPreview: apiKeyEncrypted ? `••••${this.encryption.decrypt(apiKeyEncrypted).slice(-4)}` : null,
    };
  }

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
    return this.toPublic(await this.getRaw());
  }

  async update(dto: UpdateAiSettingsDto) {
    const current = await this.getRaw();
    const { apiKey, ...rest } = dto;

    const updated = await this.prisma.db.aiSettings.update({
      where: { id: current.id },
      data: {
        ...rest,
        ...(apiKey ? { apiKeyEncrypted: this.encryption.encrypt(apiKey) } : {}),
      },
    });

    return this.toPublic(updated);
  }

  async clearApiKey() {
    const current = await this.getRaw();
    const updated = await this.prisma.db.aiSettings.update({
      where: { id: current.id },
      data: { apiKeyEncrypted: null },
    });
    return this.toPublic(updated);
  }
}
