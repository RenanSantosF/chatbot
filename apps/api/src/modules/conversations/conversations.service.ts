import { Injectable, NotFoundException } from '@nestjs/common';
import type { AiMode, ConversationStatus } from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { CustomersService } from '../customers/customers.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const OPEN_STATUSES: ConversationStatus[] = ['OPEN', 'WAITING_CUSTOMER', 'WAITING_AGENT'];

const conversationInclude = {
  customer: true,
  assignedUser: { select: { id: true, name: true, email: true, avatar: true } },
} as const;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly customers: CustomersService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(filter: { status?: ConversationStatus; assignedUserId?: string }) {
    return this.prisma.db.conversation.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.assignedUserId ? { assignedUserId: filter.assignedUserId } : {}),
      },
      include: conversationInclude,
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  private async requireConversation(id: string) {
    const conversation = await this.prisma.db.conversation.findFirst({
      where: { id },
      include: { ...conversationInclude, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada.');
    }
    return conversation;
  }

  async getById(id: string) {
    return this.requireConversation(id);
  }

  async sendAgentMessage(conversationId: string, agentId: string, content: string) {
    await this.requireConversation(conversationId);

    const message = await this.prisma.db.message.create({
      data: {
        tenantId: this.prisma.tenantId,
        conversationId,
        senderType: 'AGENT',
        senderId: agentId,
        content,
      },
    });

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt, status: 'WAITING_CUSTOMER' },
      include: conversationInclude,
    });

    this.realtime.emitToTenant(this.prisma.tenantId, 'message.created', { conversationId, message });
    this.realtime.emitToTenant(this.prisma.tenantId, 'conversation.updated', conversation);

    return message;
  }

  async assign(conversationId: string, userId: string) {
    await this.requireConversation(conversationId);

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: { assignedUserId: userId, aiMode: 'HUMAN_ACTIVE', status: 'WAITING_AGENT' },
      include: conversationInclude,
    });

    this.realtime.emitToTenant(this.prisma.tenantId, 'conversation.updated', conversation);
    return conversation;
  }

  async resolve(conversationId: string) {
    await this.requireConversation(conversationId);

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: { status: 'RESOLVED' },
      include: conversationInclude,
    });

    this.realtime.emitToTenant(this.prisma.tenantId, 'conversation.updated', conversation);
    return conversation;
  }

  async setAiMode(conversationId: string, aiMode: AiMode) {
    await this.requireConversation(conversationId);

    const conversation = await this.prisma.db.conversation.update({
      where: { id: conversationId },
      data: { aiMode },
      include: conversationInclude,
    });

    this.realtime.emitToTenant(this.prisma.tenantId, 'conversation.updated', conversation);
    return conversation;
  }

  /**
   * Recebe uma mensagem de cliente vinda de qualquer canal: encontra ou cria
   * o cliente pelo telefone, reaproveita uma conversa em aberto ou cria uma
   * nova, grava a mensagem. É o mesmo caminho que o webhook do WhatsApp vai
   * chamar na Fase 7.
   */
  async receiveInbound(input: { customerPhone: string; customerName: string; content: string }) {
    const customer = await this.customers.findOrCreateByPhone({
      phone: input.customerPhone,
      name: input.customerName,
    });

    let conversation = await this.prisma.db.conversation.findFirst({
      where: { customerId: customer.id, status: { in: OPEN_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });

    if (!conversation) {
      conversation = await this.prisma.db.conversation.create({
        data: { tenantId: this.prisma.tenantId, customerId: customer.id, channel: 'INTERNAL' },
      });
    }

    const message = await this.prisma.db.message.create({
      data: {
        tenantId: this.prisma.tenantId,
        conversationId: conversation.id,
        senderType: 'CUSTOMER',
        content: input.content,
      },
    });

    const updated = await this.prisma.db.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: message.createdAt, status: 'OPEN' },
      include: conversationInclude,
    });

    this.realtime.emitToTenant(this.prisma.tenantId, 'message.created', {
      conversationId: conversation.id,
      message,
    });
    this.realtime.emitToTenant(this.prisma.tenantId, 'conversation.updated', updated);

    return { conversation: updated, message };
  }
}
