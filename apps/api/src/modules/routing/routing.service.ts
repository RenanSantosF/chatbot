import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ConversationPriority } from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { slugify } from '../../common/utils/slugify';
import { QueuesService } from '../queues/queues.service';
import type {
  CreateRoutingRuleDto,
  UpdateRoutingRuleDto,
} from './dto/routing-rule.dto';

const ruleInclude = {
  targetUser: { select: { id: true, name: true, email: true, avatar: true } },
  targetQueue: { select: { id: true, key: true, name: true } },
} as const;

const PRIORITY_RANK: Record<ConversationPriority, number> = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  URGENT: 3,
};

export interface RoutingTarget {
  ruleName: string;
  queueId: string | null;
  assignedUserId: string | null;
}

@Injectable()
export class RoutingService {
  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly queues: QueuesService,
  ) {}

  list() {
    return this.prisma.db.routingRule.findMany({
      include: ruleInclude,
      orderBy: [{ priorityOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async requireRule(id: string) {
    const rule = await this.prisma.db.routingRule.findFirst({
      where: { id },
      include: ruleInclude,
    });
    if (!rule) {
      throw new NotFoundException('Regra não encontrada.');
    }
    return rule;
  }

  private async uniqueKey(name: string): Promise<string> {
    const base = slugify(name) || 'regra';
    let candidate = base;
    let attempt = 1;
    while (
      await this.prisma.db.routingRule.findFirst({ where: { key: candidate } })
    ) {
      attempt += 1;
      candidate = `${base}-${attempt}`;
    }
    return candidate;
  }

  private assertHasTarget(target: {
    targetUserId?: string | null;
    targetQueueId?: string | null;
  }) {
    if (!target.targetUserId && !target.targetQueueId) {
      throw new BadRequestException(
        'Escolha um destino pra regra: uma pessoa ou uma fila.',
      );
    }
  }

  async create(dto: CreateRoutingRuleDto) {
    this.assertHasTarget(dto);
    const key = await this.uniqueKey(dto.name);

    return this.prisma.db.routingRule.create({
      data: {
        tenantId: this.prisma.tenantId,
        key,
        name: dto.name,
        subject: dto.subject,
        minPriority: dto.minPriority ?? 'NORMAL',
        targetUserId: dto.targetUserId ?? null,
        targetQueueId: dto.targetQueueId ?? null,
      },
      include: ruleInclude,
    });
  }

  async update(id: string, dto: UpdateRoutingRuleDto) {
    const current = await this.requireRule(id);

    // Só valida o destino quando ele está sendo mexido — um PATCH que só
    // renomeia a regra não precisa reenviar o destino.
    if (dto.targetUserId !== undefined || dto.targetQueueId !== undefined) {
      this.assertHasTarget({
        targetUserId:
          dto.targetUserId !== undefined ? dto.targetUserId : current.targetUserId,
        targetQueueId:
          dto.targetQueueId !== undefined
            ? dto.targetQueueId
            : current.targetQueueId,
      });
    }

    return this.prisma.db.routingRule.update({
      where: { id },
      data: dto,
      include: ruleInclude,
    });
  }

  async remove(id: string) {
    await this.requireRule(id);
    await this.prisma.db.routingRule.delete({ where: { id } });
    return { ok: true };
  }

  /** Regras ativas que a IA pode escolher, na forma que vai pro prompt. */
  async listForAi() {
    const rules = await this.prisma.db.routingRule.findMany({
      where: { active: true },
      orderBy: [{ priorityOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rules.map((rule) => ({ key: rule.key, subject: rule.subject }));
  }

  /**
   * Resolve pra quem a conversa vai. Uma regra que exige prioridade maior
   * do que a da conversa é ignorada — é assim que "só urgente vai pro
   * plantonista" funciona sem mandar o dia inteiro pra ele. Quando a regra
   * aponta pra uma fila, quem escolhe a pessoa é o rodízio dela.
   */
  async resolveTarget(
    ruleKey: string | null,
    priority: ConversationPriority,
  ): Promise<RoutingTarget | null> {
    if (!ruleKey) return null;

    const rule = await this.prisma.db.routingRule.findFirst({
      where: { key: ruleKey, active: true },
    });
    if (!rule || PRIORITY_RANK[priority] < PRIORITY_RANK[rule.minPriority]) {
      return null;
    }

    if (rule.targetUserId) {
      return {
        ruleName: rule.name,
        queueId: rule.targetQueueId,
        assignedUserId: rule.targetUserId,
      };
    }

    if (rule.targetQueueId) {
      const assignedUserId = await this.queues.pickNextMember(rule.targetQueueId);
      return {
        ruleName: rule.name,
        queueId: rule.targetQueueId,
        assignedUserId,
      };
    }

    return null;
  }
}
