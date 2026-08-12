import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import type { ConversationStatus } from '../../../generated/prisma/client';
import type { RequestUser } from '../auth/auth.types';
import { ConversationsService } from './conversations.service';
import { SendMessageDto } from './dto/send-message.dto';
import { SimulateInboundDto } from './dto/simulate-inbound.dto';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  list(
    @Query('status') status: ConversationStatus | undefined,
    @Query('mine') mine: string | undefined,
    @Query('queueId') queueId: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.list({
      status,
      assignedUserId: mine === 'true' ? user.userId : undefined,
      queueId,
    });
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.conversationsService.getById(id);
  }

  @Post(':id/messages')
  sendMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.sendAgentMessage(
      id,
      user.userId,
      dto.content,
    );
  }

  @Post(':id/assign')
  assign(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.conversationsService.assign(id, user.userId);
  }

  @Post(':id/resolve')
  resolve(@Param('id') id: string) {
    return this.conversationsService.resolve(id);
  }

  @Post(':id/reactivate-ai')
  reactivateAi(@Param('id') id: string) {
    return this.conversationsService.setAiMode(id, 'AI_ACTIVE');
  }

  /** Ferramenta de teste: simula uma mensagem chegando de um cliente, sem depender do WhatsApp (Fase 7). */
  @Post('simulate-inbound')
  @Roles('OWNER', 'ADMIN')
  simulateInbound(@Body() dto: SimulateInboundDto) {
    return this.conversationsService.receiveInbound(dto);
  }
}
