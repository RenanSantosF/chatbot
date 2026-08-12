import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { UpdateWhatsAppSettingsDto } from './dto/update-whatsapp-settings.dto';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const GRAPH_API_VERSION = 'v21.0';

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

  /**
   * O token que o tenant colou já "sabe" a que WABA ele pertence — a Meta
   * expõe isso via debug_token (granular_scopes), então não precisamos
   * pedir esse ID pro usuário caçar na própria UI da Meta, que muda de
   * lugar com frequência e é confuso de achar pelo celular.
   */
  private async discoverWabaId(accessToken: string): Promise<string | null> {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const body: unknown = await response.json().catch(() => null);
    const scopes =
      body &&
      typeof body === 'object' &&
      'data' in body &&
      body.data &&
      typeof body.data === 'object' &&
      'granular_scopes' in body.data &&
      Array.isArray(body.data.granular_scopes)
        ? (body.data.granular_scopes as Array<{
            scope?: string;
            target_ids?: string[];
          }>)
        : [];

    const whatsappScope = scopes.find(
      (scope) =>
        scope.scope === 'whatsapp_business_messaging' ||
        scope.scope === 'whatsapp_business_management',
    );

    return whatsappScope?.target_ids?.[0] ?? null;
  }

  /**
   * Salvar a URL do webhook no app não é suficiente pra receber mensagens
   * de verdade — o app também precisa estar inscrito na WABA (WhatsApp
   * Business Account) especificamente. Isso normalmente acontece sozinho no
   * fluxo guiado da Meta, mas fica pra trás quando os campos são
   * preenchidos manualmente. Este endpoint chama a Graph API pra fazer essa
   * inscrição diretamente, sem precisar de terminal — e descobre o WABA ID
   * sozinho a partir do token se ainda não estiver salvo.
   */
  async subscribeApp() {
    const current = await this.getRaw();
    if (!current) {
      throw new BadRequestException(
        'Conecte o WhatsApp primeiro (Phone number ID, token e App Secret).',
      );
    }

    const accessToken = this.encryption.decrypt(current.accessTokenEncrypted);
    let wabaId = current.wabaId;

    if (!wabaId) {
      wabaId = await this.discoverWabaId(accessToken);
      if (!wabaId) {
        throw new BadRequestException(
          'Não consegui descobrir o ID da conta comercial do WhatsApp a partir do token. Confira se o token de acesso está certo e tem a permissão whatsapp_business_management.',
        );
      }
      await this.prisma.db.whatsAppSettings.update({
        where: { id: current.id },
        data: { wabaId },
      });
    }

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/subscribed_apps`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        body &&
        typeof body === 'object' &&
        'error' in body &&
        body.error &&
        typeof body.error === 'object' &&
        'message' in body.error
          ? String(body.error.message)
          : `Erro ${response.status} da Meta.`;
      throw new BadRequestException(
        `Não deu pra ativar o recebimento de mensagens: ${message}`,
      );
    }

    return this.toPublic({ ...current, wabaId });
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
