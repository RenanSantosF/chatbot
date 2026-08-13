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

  /**
   * Devolve o wamid da mensagem na Meta quando o envio dá certo (e null em
   * qualquer falha) — é por esse id que os webhooks de status depois
   * encontram a mensagem pra marcar entregue/lida no painel.
   */
  async sendText(
    to: string,
    body: string,
    replyToExternalId?: string | null,
  ): Promise<string | null> {
    const settings = await this.prisma.db.whatsAppSettings.findFirst();
    if (!settings) {
      this.logger.warn(
        `Tenant ${this.prisma.tenantId} sem WhatsApp conectado — mensagem não enviada.`,
      );
      return null;
    }

    const accessToken = this.encryption.decrypt(settings.accessTokenEncrypted);
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${settings.phoneNumberId}/messages`;

    this.logger.log(
      `Enviando mensagem via WhatsApp: phoneNumberId=${settings.phoneNumberId}, to=${to}`,
    );

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
          // context faz a mensagem sair como resposta citada no aparelho
          // do cliente, do mesmo jeito que o WhatsApp normal.
          ...(replyToExternalId
            ? { context: { message_id: replyToExternalId } }
            : {}),
        }),
      });

      const responseBody = await response.text();

      if (!response.ok) {
        this.logger.error(
          `Falha ao enviar mensagem via WhatsApp (${response.status}): ${responseBody}`,
        );
        return null;
      }

      this.logger.log(
        `Mensagem enviada via WhatsApp com sucesso: ${responseBody}`,
      );
      return this.extractMessageId(responseBody);
    } catch (error) {
      this.logger.error(
        `Erro de rede ao enviar mensagem via WhatsApp: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /**
   * Envia uma mídia já hospedada na Meta (ver WhatsappMediaService.upload).
   * `kind` decide o campo do payload — a Cloud API não aceita um "anexo"
   * genérico, cada tipo tem o seu, e só `document` aceita filename.
   */
  /**
   * Envia um template aprovado. É o único jeito de falar com alguém fora
   * da janela de 24 horas — depois desse prazo a Meta recusa texto livre,
   * então "iniciar conversa" sempre passa por aqui.
   *
   * Diferente dos outros envios, este PROPAGA o erro: quem inicia uma
   * conversa precisa saber na hora que o template foi recusado, senão
   * ficaria olhando pra uma conversa vazia sem entender o motivo.
   */
  async sendTemplate(
    to: string,
    template: { name: string; language: string; bodyParams?: string[] },
  ): Promise<string> {
    const settings = await this.prisma.db.whatsAppSettings.findFirst();
    if (!settings) {
      throw new Error('WhatsApp não está conectado nesta empresa.');
    }

    const accessToken = this.encryption.decrypt(settings.accessTokenEncrypted);
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${settings.phoneNumberId}/messages`;

    const components = template.bodyParams?.length
      ? [
          {
            type: 'body',
            parameters: template.bodyParams.map((text) => ({
              type: 'text',
              text,
            })),
          },
        ]
      : undefined;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: template.name,
          language: { code: template.language },
          ...(components ? { components } : {}),
        },
      }),
    });

    const payload = (await response.json()) as {
      messages?: { id?: string }[];
      error?: { message?: string };
    };

    if (!response.ok) {
      const detail = payload.error?.message ?? 'motivo não informado';
      this.logger.error(`Falha ao enviar template ${template.name}: ${detail}`);
      throw new Error(`A Meta recusou o template: ${detail}`);
    }

    return payload.messages?.[0]?.id ?? '';
  }

  /** Templates aprovados da conta, pra montar a tela de iniciar conversa. */
  async listTemplates(): Promise<
    { name: string; language: string; body: string; placeholders: number }[]
  > {
    const settings = await this.prisma.db.whatsAppSettings.findFirst();
    if (!settings?.wabaId) {
      throw new Error(
        'Informe o ID da conta comercial (WABA) em Configurações > WhatsApp pra listar os templates.',
      );
    }

    const accessToken = this.encryption.decrypt(settings.accessTokenEncrypted);
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${settings.wabaId}/message_templates?limit=100&status=APPROVED`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    const payload = (await response.json()) as {
      data?: {
        name: string;
        language: string;
        status: string;
        components?: { type: string; text?: string }[];
      }[];
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(payload.error?.message ?? 'Não deu pra listar os templates.');
    }

    return (payload.data ?? []).map((template) => {
      const body =
        template.components?.find((part) => part.type === 'BODY')?.text ?? '';
      // {{1}}, {{2}}... são os buracos que a empresa preenche na hora do
      // envio; contar aqui evita a tela ter que reimplementar o parser.
      const placeholders = new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;
      return {
        name: template.name,
        language: template.language,
        body,
        placeholders,
      };
    });
  }

  async sendMedia(
    to: string,
    kind: 'image' | 'document' | 'audio' | 'video',
    mediaId: string,
    options: { caption?: string; filename?: string } = {},
  ): Promise<string | null> {
    const settings = await this.prisma.db.whatsAppSettings.findFirst();
    if (!settings) {
      this.logger.warn(
        `Tenant ${this.prisma.tenantId} sem WhatsApp conectado — mídia não enviada.`,
      );
      return null;
    }

    const accessToken = this.encryption.decrypt(settings.accessTokenEncrypted);
    const media: Record<string, string> = { id: mediaId };
    if (options.caption && kind !== 'audio') media.caption = options.caption;
    if (options.filename && kind === 'document') media.filename = options.filename;

    try {
      const response = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${settings.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: kind,
            [kind]: media,
          }),
        },
      );

      const responseBody = await response.text();
      if (!response.ok) {
        this.logger.error(
          `Falha ao enviar mídia via WhatsApp (${response.status}): ${responseBody}`,
        );
        return null;
      }
      return this.extractMessageId(responseBody);
    } catch (error) {
      this.logger.error(
        `Erro de rede ao enviar mídia via WhatsApp: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /**
   * Acende o tique azul no aparelho do cliente. A Meta exige o wamid da
   * mensagem recebida; não existe "marcar a conversa toda", marcar a mais
   * recente já marca as anteriores.
   */
  async markAsRead(messageId: string): Promise<void> {
    const settings = await this.prisma.db.whatsAppSettings.findFirst();
    if (!settings) return;

    const accessToken = this.encryption.decrypt(settings.accessTokenEncrypted);
    try {
      const response = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${settings.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
          }),
        },
      );
      if (!response.ok) {
        this.logger.warn(
          `Não deu pra marcar como lida (${response.status}): ${await response.text()}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Erro de rede ao marcar como lida: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /** Reage a uma mensagem do cliente. Emoji vazio remove a reação. */
  async sendReaction(to: string, messageId: string, emoji: string): Promise<void> {
    const settings = await this.prisma.db.whatsAppSettings.findFirst();
    if (!settings) return;

    const accessToken = this.encryption.decrypt(settings.accessTokenEncrypted);
    try {
      await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${settings.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'reaction',
            reaction: { message_id: messageId, emoji },
          }),
        },
      );
    } catch (error) {
      this.logger.warn(
        `Erro ao enviar reação: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private extractMessageId(responseBody: string): string | null {
    try {
      const parsed = JSON.parse(responseBody) as {
        messages?: { id?: string }[];
      };
      return parsed.messages?.[0]?.id ?? null;
    } catch {
      return null;
    }
  }
}
