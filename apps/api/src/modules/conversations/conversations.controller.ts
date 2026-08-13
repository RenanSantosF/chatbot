import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import type {
  ConversationPriority,
  ConversationStatus,
} from '../../../generated/prisma/client';
import type { RequestUser } from '../auth/auth.types';
import { ConversationsService } from './conversations.service';
import { StartConversationDto } from './dto/start-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SetPriorityDto } from './dto/set-priority.dto';
import { SimulateInboundDto } from './dto/simulate-inbound.dto';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  list(
    @Query('status') status: ConversationStatus | undefined,
    @Query('mine') mine: string | undefined,
    @Query('queueId') queueId: string | undefined,
    @Query('customerId') customerId: string | undefined,
    @Query('priority') priority: ConversationPriority | undefined,
    @Query('unread') unread: string | undefined,
    @Query('unassigned') unassigned: string | undefined,
    @Query('search') search: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.list({
      status,
      assignedUserId: mine === 'true' ? user.userId : undefined,
      unassignedOnly: unassigned === 'true',
      queueId,
      customerId,
      priority,
      unreadOnly: unread === 'true',
      search,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('counts')
  counts(@CurrentUser() user: RequestUser) {
    return this.conversationsService.counts(user.userId);
  }

  // Estas rotas ficam ANTES de ':id' de propósito: o Nest casa na ordem
  // de declaração, e ':id' engoliria 'templates', devolvendo
  // "conversa não encontrada" pra uma rota que existe.
  @Get('templates')
  templates() {
    return this.conversationsService.listTemplates();
  }

  @Post('start')
  start(
    @Body() dto: StartConversationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.startConversation(dto, user.userId);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.conversationsService.getById(id);
  }

  /** Páginas anteriores do histórico — usado pela rolagem infinita pra cima. */
  @Get(':id/messages')
  listMessages(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversationsService.listMessages(id, {
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post(':id/messages/:messageId/reaction')
  react(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body('emoji') emoji: string,
  ) {
    return this.conversationsService.reactToMessage(id, messageId, emoji ?? '');
  }

  @Post(':id/messages/:messageId/forward')
  forward(
    @Param('messageId') messageId: string,
    @Body('toConversationId') toConversationId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.forwardMessage(
      messageId,
      toConversationId,
      user.userId,
    );
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
      dto.replyToId,
    );
  }

  @Post(':id/assign')
  assign(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.conversationsService.assign(id, user.userId);
  }

  @Post(':id/transfer')
  transfer(
    @Param('id') id: string,
    @Body('toUserId') toUserId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.transferTo(id, toUserId, user.userId);
  }

  @Post(':id/accept')
  accept(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.conversationsService.acceptAssignment(id, user.userId);
  }

  @Post(':id/decline')
  decline(
    @Param('id') id: string,
    @Body('reason') reason: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.declineAssignment(id, user.userId, reason);
  }

  @Post(':id/reopen')
  reopen(@Param('id') id: string) {
    return this.conversationsService.reopen(id);
  }

  @Post(':id/resolve')
  resolve(@Param('id') id: string) {
    return this.conversationsService.resolve(id);
  }

  /**
   * Limite de 16 MB porque é o teto da própria Cloud API pra vídeo/áudio
   * (documento vai até 100 MB, mas manter um número só evita prometer o
   * que a Meta recusaria depois do upload).
   */
  @Post(':id/attachments')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 16 * 1024 * 1024 } }),
  )
  sendAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
    @Body('caption') caption?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado.');
    }
    return this.conversationsService.sendAttachment(
      id,
      user.userId,
      file,
      caption,
    );
  }

  @Post(':id/priority')
  setPriority(@Param('id') id: string, @Body() dto: SetPriorityDto) {
    return this.conversationsService.setPriority(id, dto.priority);
  }

  @Post(':id/reactivate-ai')
  reactivateAi(@Param('id') id: string) {
    return this.conversationsService.setAiMode(id, 'AI_ACTIVE');
  }

  /** Ferramenta de teste: simula uma mensagem chegando de um cliente, sem precisar de um WhatsApp real. */
  @Post('simulate-inbound')
  @Roles('OWNER', 'ADMIN')
  simulateInbound(@Body() dto: SimulateInboundDto) {
    return this.conversationsService.receiveInbound(dto);
  }
}
