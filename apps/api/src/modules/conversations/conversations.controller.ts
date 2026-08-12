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
    @Query('sort') sort: 'recent' | 'priority' | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.conversationsService.list({
      status,
      assignedUserId: mine === 'true' ? user.userId : undefined,
      queueId,
      customerId,
      priority,
      unreadOnly: unread === 'true',
      sort,
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
