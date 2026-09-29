import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.types';
import { ConversationsService } from '../conversations/conversations.service';
import { TasksService } from './tasks.service';

/**
 * Tarefas de uma conversa, com o mesmo recorte de quem vê a conversa.
 *
 * Duas brechas fechadas aqui. Sem `conversationId`, o filtro virava
 * `undefined` — que o banco ignora — e a rota devolvia TODAS as tarefas da
 * empresa. E mesmo com ele, qualquer pessoa da conta lia (e concluía) a
 * tarefa de uma conversa de outro setor, que ela nem enxerga no Inbox.
 */
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly conversations: ConversationsService,
  ) {}

  @Get()
  async list(
    @Query('conversationId') conversationId: string | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!conversationId) {
      throw new BadRequestException('Informe a conversa.');
    }
    await this.conversations.garantirConversaVisivel(conversationId, {
      userId: user.userId,
      role: user.role,
    });
    return this.tasksService.listByConversation(conversationId);
  }

  @Patch(':id/complete')
  async complete(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    const task = await this.tasksService.buscar(id);
    if (task.conversationId) {
      await this.conversations.garantirConversaVisivel(task.conversationId, {
        userId: user.userId,
        role: user.role,
      });
    }
    return this.tasksService.complete(id);
  }
}
