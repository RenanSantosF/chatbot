import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Public } from '../../common/auth/public.decorator';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ConversationsService } from '../conversations/conversations.service';
import type { WhatsAppWebhookPayload } from './whatsapp-webhook.types';

/**
 * Entrada única de webhook pra plataforma inteira — a Meta chama esta
 * mesma URL pra qualquer tenant. Cada tenant configura seu próprio app no
 * Meta Developers apontando pra cá; identificamos de qual tenant é a
 * mensagem pelo phone_number_id que vem em todo payload (ver
 * WhatsAppSettings.phoneNumberId, único globalmente).
 */
@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationsService: ConversationsService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Handshake exigido pela Meta ao salvar a URL do webhook no app: ela manda
   * um GET com um challenge e espera recebê-lo de volta, só se o
   * verify_token bater. Esse token é da plataforma (um só, configurado no
   * .env), não por tenant — só confirma que essa URL realmente é nossa.
   */
  @Public()
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
  ) {
    if (
      mode === 'subscribe' &&
      verifyToken === process.env.WHATSAPP_VERIFY_TOKEN
    ) {
      return challenge;
    }
    throw new ForbiddenException('Verify token inválido.');
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: RawBodyRequest<Request> & AuthenticatedRequest,
    @Body() body: WhatsAppWebhookPayload,
  ) {
    const value = body.entry?.[0]?.changes?.[0]?.value;
    const phoneNumberId = value?.metadata?.phone_number_id;
    const wabaId = body.entry?.[0]?.id;
    const messages = value?.messages ?? [];
    this.logger.log(
      `POST recebido: wabaId=${wabaId ?? 'ausente'}, phoneNumberId=${phoneNumberId ?? 'ausente'}, mensagens=${messages.length}`,
    );

    // Sem phone_number_id não tem como saber de qual tenant é — provavelmente
    // é um evento de status (entregue/lido) sem "messages", que ignoramos
    // silenciosamente. Sempre responde 200: a Meta reenvia (e eventualmente
    // desativa o webhook) se não receber 2xx rápido.
    if (!phoneNumberId) {
      return { ok: true };
    }

    const settings = await this.prisma.client.whatsAppSettings.findFirst({
      where: { phoneNumberId },
    });
    if (!settings) {
      this.logger.warn(
        `Webhook recebido pra phone_number_id desconhecido: ${phoneNumberId}`,
      );
      return { ok: true };
    }

    if (!this.hasValidSignature(req, settings.appSecretEncrypted)) {
      this.logger.warn(`Assinatura inválida pro tenant ${settings.tenantId}.`);
      throw new ForbiddenException('Assinatura inválida.');
    }

    if (messages.length === 0) {
      // Evento de status (enviado/entregue/lido/falhou) de uma mensagem que a
      // gente mandou — só loga, não precisa fazer mais nada por enquanto.
      for (const status of value?.statuses ?? []) {
        const errorDetail = status.errors?.[0]
          ? ` erro=${status.errors[0].code} ${status.errors[0].title ?? ''} ${status.errors[0].message ?? ''}`.trim()
          : '';
        this.logger.log(
          `Status de mensagem: id=${status.id}, status=${status.status}, para=${status.recipient_id}.${errorDetail}`,
        );
      }
      return { ok: true };
    }

    // Injeta um "usuário" sintético pro resto do pipeline (TenantPrismaService,
    // usado por ConversationsService) resolver o tenant certo — não existe
    // JWT aqui, quem autentica essa requisição é a assinatura HMAC acima.
    req.user = {
      userId: 'whatsapp-webhook',
      tenantId: settings.tenantId,
      role: 'OWNER',
      email: 'webhook@whatsapp',
      name: 'WhatsApp',
    };

    const contact = value?.contacts?.[0];

    for (const message of messages) {
      if (message.type !== 'text' || !message.from || !message.text?.body) {
        // MVP: só texto. Áudio/imagem/documento ficam pra depois.
        continue;
      }

      await this.conversationsService.receiveInbound({
        customerPhone: message.from,
        customerName: contact?.profile?.name ?? message.from,
        content: message.text.body,
        channel: 'WHATSAPP',
      });
      this.logger.log(
        `Mensagem processada pro tenant ${settings.tenantId} (de ${message.from}).`,
      );
    }

    return { ok: true };
  }

  private hasValidSignature(
    req: RawBodyRequest<Request>,
    appSecretEncrypted: string,
  ): boolean {
    const header = req.headers['x-hub-signature-256'];
    if (!header || typeof header !== 'string' || !req.rawBody) {
      return false;
    }

    const receivedSignature = header.replace('sha256=', '');
    const appSecret = this.encryption.decrypt(appSecretEncrypted);
    const expectedSignature = createHmac('sha256', appSecret)
      .update(req.rawBody)
      .digest('hex');

    const received = Buffer.from(receivedSignature, 'hex');
    const expected = Buffer.from(expectedSignature, 'hex');
    if (received.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(received, expected);
  }
}
