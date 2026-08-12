import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { slugify } from '../../common/utils/slugify';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import type { CreateQueueDto, UpdateQueueDto } from './dto/queue.dto';

const memberInclude = {
  members: { include: { user: { select: { id: true, name: true, email: true, avatar: true } } } },
} as const;

@Injectable()
export class QueuesService {
  constructor(private readonly prisma: TenantPrismaService) {}

  list() {
    return this.prisma.db.queue.findMany({ include: memberInclude, orderBy: { createdAt: 'asc' } });
  }

  private async requireQueue(id: string) {
    const queue = await this.prisma.db.queue.findFirst({ where: { id }, include: memberInclude });
    if (!queue) {
      throw new NotFoundException('Fila não encontrada.');
    }
    return queue;
  }

  private async uniqueKey(name: string): Promise<string> {
    const base = slugify(name) || 'fila';
    let candidate = base;
    let attempt = 1;
    while (await this.prisma.db.queue.findFirst({ where: { key: candidate } })) {
      attempt += 1;
      candidate = `${base}-${attempt}`;
    }
    return candidate;
  }

  async create(dto: CreateQueueDto) {
    const key = await this.uniqueKey(dto.name);
    return this.prisma.db.queue.create({
      data: { tenantId: this.prisma.tenantId, key, name: dto.name, description: dto.description },
      include: memberInclude,
    });
  }

  async update(id: string, dto: UpdateQueueDto) {
    await this.requireQueue(id);
    return this.prisma.db.queue.update({ where: { id }, data: dto, include: memberInclude });
  }

  async remove(id: string) {
    await this.requireQueue(id);
    await this.prisma.db.queue.delete({ where: { id } });
    return { ok: true };
  }

  async addMember(queueId: string, userId: string) {
    await this.requireQueue(queueId);

    const user = await this.prisma.db.user.findFirst({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const existing = await this.prisma.db.queueMember.findFirst({ where: { queueId, userId } });
    if (existing) {
      throw new ConflictException('Este usuário já está nesta fila.');
    }
    await this.prisma.db.queueMember.create({
      data: { tenantId: this.prisma.tenantId, queueId, userId },
    });
    return this.requireQueue(queueId);
  }

  async removeMember(queueId: string, userId: string) {
    await this.requireQueue(queueId);
    await this.prisma.db.queueMember.deleteMany({ where: { queueId, userId } });
    return this.requireQueue(queueId);
  }

  /**
   * Round-robin de verdade: avança um ponteiro salvo na própria fila, não
   * uma aproximação por "quem está há mais tempo sem receber". Se o membro
   * do ponteiro saiu da fila, simplesmente recomeça do início.
   */
  async pickNextMember(queueId: string): Promise<string | null> {
    const queue = await this.prisma.db.queue.findFirst({
      where: { id: queueId },
      include: { members: { orderBy: { createdAt: 'asc' } } },
    });

    if (!queue || queue.members.length === 0) {
      return null;
    }

    const memberIds = queue.members.map((member) => member.userId);
    const lastIndex = queue.lastAssignedMemberId ? memberIds.indexOf(queue.lastAssignedMemberId) : -1;
    const nextMemberId = memberIds[(lastIndex + 1) % memberIds.length];

    await this.prisma.db.queue.update({
      where: { id: queueId },
      data: { lastAssignedMemberId: nextMemberId },
    });

    return nextMemberId;
  }

  async findByKey(key: string) {
    return this.prisma.db.queue.findFirst({ where: { key } });
  }

  async findById(id: string) {
    return this.prisma.db.queue.findFirst({ where: { id } });
  }
}
