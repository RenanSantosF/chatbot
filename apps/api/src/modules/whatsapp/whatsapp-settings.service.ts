import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { UpdateWhatsAppSettingsDto } from './dto/update-whatsapp-settings.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class WhatsappSettingsService {
  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  webhookUrl(): string {
    const base =
      process.env.API_PUBLIC_URL ??
      `http://localhost:${process.env.PORT ?? 3001}`;
    return `${base}/api/webhooks/whatsapp`;
  }

  /**
   * Diferente da API key da IA (criada automaticamente pra todo tenant no
   * registro), WhatsApp é opcional e não existe até o tenant configurar —
   * então aqui não tem upsert de "linha vazia", só retorna null.
   */
  private getRaw() {
    return this.prisma.db.whatsAppSettings.findFirst();
  }

  private toPublic(settings: Awaited<ReturnType<typeof this.getRaw>>) {
    if (!settings) {
      return {
        connected: false,
        phoneNumberId: null,
        displayPhoneNumber: null,
        wabaId: null,
        hasAccessToken: false,
        hasAppSecret: false,
        webhookUrl: this.webhookUrl(),
      };
    }

    return {
      connected: true,
      phoneNumberId: settings.phoneNumberId,
      displayPhoneNumber: settings.displayPhoneNumber,
      wabaId: settings.wabaId,
      hasAccessToken: Boolean(settings.accessTokenEncrypted),
      hasAppSecret: Boolean(settings.appSecretEncrypted),
      webhookUrl: this.webhookUrl(),
    };
  }

  async get() {
    return this.toPublic(await this.getRaw());
  }

  async update(dto: UpdateWhatsAppSettingsDto) {
    const current = await this.getRaw();
    const { accessToken, appSecret, ...rest } = dto;

    if (!current && (!accessToken || !appSecret)) {
      throw new BadRequestException(
        'Pra conectar o WhatsApp pela primeira vez, informe o token de acesso e o app secret.',
      );
    }

    try {
      const updated = current
        ? await this.prisma.db.whatsAppSettings.update({
            where: { id: current.id },
            data: {
              ...rest,
              ...(accessToken
                ? { accessTokenEncrypted: this.encryption.encrypt(accessToken) }
                : {}),
              ...(appSecret
                ? { appSecretEncrypted: this.encryption.encrypt(appSecret) }
                : {}),
            },
          })
        : await this.prisma.db.whatsAppSettings.create({
            data: {
              tenantId: this.prisma.tenantId,
              ...rest,
              accessTokenEncrypted: this.encryption.encrypt(accessToken!),
              appSecretEncrypted: this.encryption.encrypt(appSecret!),
            },
          });

      return this.toPublic(updated);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException(
          'Esse Phone number ID já está em uso por outra empresa na plataforma. Confira se não colou o ID errado.',
        );
      }
      throw error;
    }
  }

  async disconnect() {
    const current = await this.getRaw();
    if (current) {
      await this.prisma.db.whatsAppSettings.delete({
        where: { id: current.id },
      });
    }
    return this.toPublic(null);
  }
}
