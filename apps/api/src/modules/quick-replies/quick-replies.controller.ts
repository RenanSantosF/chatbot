import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RequiresPermission } from '../../common/auth/permission.decorator';
import {
  CreateQuickReplyDto,
  UpdateQuickReplyDto,
} from './dto/quick-reply.dto';
import { QuickRepliesService } from './quick-replies.service';

@Controller('quick-replies')
export class QuickRepliesController {
  constructor(private readonly quickReplies: QuickRepliesService) {}

  /**
   * Ler é de todo mundo que atende: a lista é a matéria-prima do atalho no
   * compositor, e um atendente sem ela perde o recurso inteiro.
   */
  @Get()
  list() {
    return this.quickReplies.list();
  }

  @Post()
  @RequiresPermission('quickReplies.manage')
  create(@Body() dto: CreateQuickReplyDto) {
    return this.quickReplies.create(dto);
  }

  @Patch(':id')
  @RequiresPermission('quickReplies.manage')
  update(@Param('id') id: string, @Body() dto: UpdateQuickReplyDto) {
    return this.quickReplies.update(id, dto);
  }

  @Delete(':id')
  @RequiresPermission('quickReplies.manage')
  remove(@Param('id') id: string) {
    return this.quickReplies.remove(id);
  }

  /** Usar não é gerenciar: quem atende marca o uso, quem configura edita. */
  @Post(':id/uso')
  registrarUso(@Param('id') id: string) {
    return this.quickReplies.registrarUso(id);
  }
}
