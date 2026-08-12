import { Injectable, Logger } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';

const GRAPH_API_VERSION = 'v21.0';

/**
 * Manda mensagem de saída pra Cloud API da Meta usando as credenciais do
 * próprio tenant (nunca uma chave compartilhada da plataforma) — mesmo
 * padrão de isolamento da API key da IA. Chamado pelo ConversationsService
 * sempre que a IA ou um atendente responde numa conversa cujo canal é
 * WHATSAPP; nunca lança erro pra fora, porque uma falha de envio (token
 * expirado, número sem permissão, etc.) não pode derrubar o fluxo interno
 * de conversa — a mensagem já foi salva e aparece no painel de qualquer
 * jeito, só não chega no telefone do cliente.
 */
@Injectable()
export class WhatsappSenderService {
  private readonly logger = new Logger(WhatsappSenderService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async sendText(to: string, body: string): Promise<void> {
    const settings = await this.prisma.db.whatsAppSettings.findFirst();
    if (!settings) {
      this.logger.warn(
        `Tenant ${this.prisma.tenantId} sem WhatsApp conectado — mensagem não enviada.`,
      );
      return;
    }

    const accessToken = this.encryption.decrypt(settings.accessTokenEncrypted);
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${settings.phoneNumberId}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Falha ao enviar mensagem via WhatsApp (${response.status}): ${errorBody}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Erro de rede ao enviar mensagem via WhatsApp: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
