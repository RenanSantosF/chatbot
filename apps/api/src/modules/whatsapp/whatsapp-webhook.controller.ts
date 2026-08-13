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
import type {
  MessageStatus,
  MessageType,
  Prisma,
} from '../../../generated/prisma/client';
import { Public } from '../../common/auth/public.decorator';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ConversationsService } from '../conversations/conversations.service';
import { CustomersService } from '../customers/customers.service';
import type {
  WhatsAppInboundMessage,
  WhatsAppWebhookPayload,
} from './whatsapp-webhook.types';

const MEDIA_KINDS = {
  image: 'IMAGE',
  document: 'DOCUMENT',
  audio: 'AUDIO',
  video: 'VIDEO',
  sticker: 'IMAGE',
} as const;

/**
 * Traduz a mensagem da Meta pro nosso formato. Mídia não é baixada aqui: o
 * webhook precisa responder rápido (a Meta reenvia e chega a desativar o
 * webhook em caso de lentidão), então só guardamos o id e o binário é
 * buscado sob demanda quando alguém abre a conversa no painel.
 */
function parseInboundMessage(
  message: WhatsAppInboundMessage,
): { content: string; messageType: MessageType; metadata?: Prisma.InputJsonValue } | null {
  if (message.type === 'text') {
    return message.text?.body
      ? { content: message.text.body, messageType: 'TEXT' }
      : null;
  }

  if (message.type === 'contacts' && message.contacts?.length) {
    const names = message.contacts
      .map((contact) => contact.name?.formatted_name)
      .filter(Boolean)
      .join(', ');
    return {
      content: names ? `Contato compartilhado: ${names}` : 'Contato compartilhado',
      messageType: 'OTHER',
      metadata: { contacts: message.contacts } as Prisma.InputJsonValue,
    };
  }

  if (message.type === 'location' && message.location) {
    const { latitude, longitude, name, address } = message.location;
    const label = [name, address].filter(Boolean).join(' — ');
    return {
      content: label || `Localização: ${latitude}, ${longitude}`,
      messageType: 'LOCATION',
      metadata: { latitude, longitude, name, address } as Prisma.InputJsonValue,
    };
  }

  const kind = message.type as keyof typeof MEDIA_KINDS;
  const media =
    kind === 'image'
      ? message.image
      : kind === 'document'
        ? message.document
        : kind === 'audio'
          ? message.audio
          : kind === 'video'
            ? message.video
            : kind === 'sticker'
              ? message.sticker
              : undefined;

  if (media?.id && MEDIA_KINDS[kind]) {
    return {
      // A legenda vira o texto da mensagem; sem legenda fica o nome do
      // arquivo, que é o que o atendente precisa ver na lista.
      content: media.caption ?? media.filename ?? '',
      messageType: MEDIA_KINDS[kind],
      metadata: {
        mediaId: media.id,
        mimeType: media.mime_type,
        fileName: media.filename,
        voice: media.voice ?? false,
      } as Prisma.InputJsonValue,
    };
  }

  return null;
}

/** Vocabulário de status da Meta -> o nosso. O que não estiver aqui é ignorado. */
const STATUS_MAP: Record<string, MessageStatus | undefined> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

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
    private readonly customers: CustomersService,
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

    // Agenda de contatos do aparelho (coexistência). É por aqui que os
    // contatos do WhatsApp da empresa entram no sistema — a Cloud API não
    // tem endpoint pra listar contatos, ela EMPURRA cada mudança da agenda
    // por este webhook.
    for (const evento of value?.state_sync ?? []) {
      if (evento.type !== 'contact') continue;

      const telefone = evento.contact?.phone_number;
      if (!telefone) continue;

      if (evento.action === 'remove') {
        // Apagar da agenda do celular não apaga o cliente daqui: ele pode
        // ter histórico de atendimento, e perder isso por uma faxina na
        // agenda seria perda de dado.
        this.logger.log(`Contato ${telefone} saiu da agenda; mantido no sistema.`);
        continue;
      }

      await this.customers.upsertFromAddressBook({
        phone: telefone,
        name: evento.contact?.full_name ?? evento.contact?.first_name,
      });
      this.logger.log(
        `Contato sincronizado da agenda pro tenant ${settings.tenantId}: ${telefone}.`,
      );
    }

    // Respostas dadas pelo celular (coexistência). Vêm num campo separado —
    // `message_echoes`, não `messages` — porque quem escreveu foi a empresa,
    // não o cliente. Sem tratar isto o painel mostraria a pergunta e nunca a
    // resposta, e a IA ainda responderia por cima de quem já respondeu.
    const echoes = value?.message_echoes ?? [];
    for (const echo of echoes) {
      if (!echo.to) continue;

      if (echo.type === 'revoke' || echo.type === 'edit') {
        // Apagar e editar mudariam uma mensagem já gravada. Fica de fora por
        // ora, e de propósito: some do celular, permanece no histórico daqui.
        this.logger.log(`Eco do tipo ${echo.type} ignorado (${echo.id}).`);
        continue;
      }

      const parsed = parseInboundMessage(echo);
      if (!parsed) {
        this.logger.warn(`Eco de tipo não suportado: ${echo.type}`);
        continue;
      }

      await this.conversationsService.recordOutboundEcho({
        customerPhone: echo.to,
        content: parsed.content,
        messageType: parsed.messageType,
        metadata: parsed.metadata,
        externalId: echo.id,
      });
      this.logger.log(
        `Resposta enviada pelo celular registrada pro tenant ${settings.tenantId} (para ${echo.to}).`,
      );
    }

    if (messages.length === 0) {
      // Evento de status (enviado/entregue/lido/falhou) de uma mensagem que a
      // gente mandou — vira o tique de entrega no painel.
      for (const status of value?.statuses ?? []) {
        const errorDetail = status.errors?.[0]
          ? ` erro=${status.errors[0].code} ${status.errors[0].title ?? ''} ${status.errors[0].message ?? ''}`.trim()
          : '';
        this.logger.log(
          `Status de mensagem: id=${status.id}, status=${status.status}, para=${status.recipient_id}.${errorDetail}`,
        );

        const mapped = STATUS_MAP[status.status ?? ''];
        if (mapped && status.id) {
          await this.conversationsService.applyDeliveryStatus(
            status.id,
            mapped,
          );
        }
      }
      return { ok: true };
    }

    const contact = value?.contacts?.[0];

    for (const message of messages) {
      if (!message.from) continue;

      // Reação não é mensagem nova: ela modifica a mensagem reagida, então
      // sai do laço antes de virar uma linha no histórico.
      if (message.type === 'reaction' && message.reaction?.message_id) {
        await this.conversationsService.applyReaction(
          message.reaction.message_id,
          message.reaction.emoji ?? '',
          message.from,
        );
        continue;
      }

      const parsed = parseInboundMessage(message);
      if (!parsed) {
        this.logger.warn(`Tipo de mensagem não suportado: ${message.type}`);
        continue;
      }

      await this.conversationsService.receiveInbound({
        customerPhone: message.from,
        customerName: contact?.profile?.name ?? message.from,
        content: parsed.content,
        messageType: parsed.messageType,
        metadata: parsed.metadata,
        channel: 'WHATSAPP',
        externalId: message.id,
        replyToExternalId: message.context?.id,
      });
      this.logger.log(
        `Mensagem ${parsed.messageType} processada pro tenant ${settings.tenantId} (de ${message.from}).`,
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
