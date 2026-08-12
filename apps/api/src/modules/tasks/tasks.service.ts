import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: TenantPrismaService) {}

  listByConversation(conversationId: string) {
    return this.prisma.db.task.findMany({
      where: { conversationId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async complete(id: string) {
    const task = await this.prisma.db.task.findFirst({ where: { id } });
    if (!task) {
      throw new NotFoundException('Tarefa não encontrada.');
    }
    return this.prisma.db.task.update({ where: { id }, data: { status: 'DONE' } });
  }
}
