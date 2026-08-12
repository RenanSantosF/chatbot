import { Injectable } from '@nestjs/common';
import type {
  ConversationStatus,
  MessageSenderType,
} from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';

export interface MetricsRange {
  from: Date;
  to: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: TenantPrismaService) {}

  /**
   * Tudo que a Visão geral mostra, num request só e sempre recortado pelo
   * período pedido. As contas são feitas em memória de propósito: o volume
   * por tenant é pequeno (milhares de mensagens), e assim o cálculo de
   * tempo de resposta — que precisa parear cada mensagem de cliente com a
   * resposta seguinte — fica legível em vez de virar SQL de janela.
   */
  async overview(range: MetricsRange) {
    const [conversations, messages] = await Promise.all([
      this.prisma.db.conversation.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        select: {
          id: true,
          status: true,
          createdAt: true,
          assignedUserId: true,
        },
      }),
      this.prisma.db.message.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        select: {
          conversationId: true,
          senderType: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      totals: this.buildTotals(conversations, messages),
      byDay: this.buildByDay(range, conversations, messages),
      byStatus: this.buildByStatus(conversations),
      responseTime: this.buildResponseTime(messages),
    };
  }

  private buildTotals(
    conversations: { status: ConversationStatus; assignedUserId: string | null }[],
    messages: { senderType: MessageSenderType }[],
  ) {
    const resolved = conversations.filter(
      (c) => c.status === 'RESOLVED' || c.status === 'CLOSED',
    );

    return {
      conversations: conversations.length,
      messages: messages.length,
      // "Resolvida só pela IA" = fechou sem nunca ter caído no colo de
      // ninguém. Se um atendente assumiu em algum momento, não conta.
      resolvedByAi: resolved.filter((c) => !c.assignedUserId).length,
      resolvedByHuman: resolved.filter((c) => c.assignedUserId).length,
      aiMessages: messages.filter((m) => m.senderType === 'AI').length,
      agentMessages: messages.filter((m) => m.senderType === 'AGENT').length,
    };
  }

  private buildByDay(
    range: MetricsRange,
    conversations: { createdAt: Date }[],
    messages: { createdAt: Date }[],
  ) {
    const days = new Map<
      string,
      { day: string; conversations: number; messages: number }
    >();

    // Semeia todos os dias do período, inclusive os vazios — sem isso o
    // gráfico "pula" os dias sem movimento e distorce a leitura da linha.
    for (let t = range.from.getTime(); t <= range.to.getTime(); t += DAY_MS) {
      const key = dayKey(new Date(t));
      days.set(key, { day: key, conversations: 0, messages: 0 });
    }

    for (const conversation of conversations) {
      const bucket = days.get(dayKey(conversation.createdAt));
      if (bucket) bucket.conversations += 1;
    }
    for (const message of messages) {
      const bucket = days.get(dayKey(message.createdAt));
      if (bucket) bucket.messages += 1;
    }

    return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  }

  private buildByStatus(conversations: { status: ConversationStatus }[]) {
    const counts = new Map<ConversationStatus, number>();
    for (const conversation of conversations) {
      counts.set(conversation.status, (counts.get(conversation.status) ?? 0) + 1);
    }
    return [...counts.entries()].map(([status, count]) => ({ status, count }));
  }

  /**
   * Tempo até a primeira resposta da empresa depois de cada fala do cliente,
   * separado por quem respondeu. Só conta o par cliente -> resposta imediata:
   * se o cliente mandou três mensagens seguidas, o relógio vale a partir da
   * primeira, e mensagens de sistema não interrompem a contagem.
   */
  private buildResponseTime(
    messages: {
      conversationId: string;
      senderType: MessageSenderType;
      createdAt: Date;
    }[],
  ) {
    const pendingByConversation = new Map<string, Date>();
    const aiDeltas: number[] = [];
    const humanDeltas: number[] = [];

    for (const message of messages) {
      if (message.senderType === 'CUSTOMER') {
        if (!pendingByConversation.has(message.conversationId)) {
          pendingByConversation.set(message.conversationId, message.createdAt);
        }
        continue;
      }

      if (message.senderType !== 'AI' && message.senderType !== 'AGENT') {
        continue;
      }

      const askedAt = pendingByConversation.get(message.conversationId);
      if (!askedAt) continue;

      const seconds = (message.createdAt.getTime() - askedAt.getTime()) / 1000;
      pendingByConversation.delete(message.conversationId);
      (message.senderType === 'AI' ? aiDeltas : humanDeltas).push(seconds);
    }

    return {
      aiSeconds: average(aiDeltas),
      humanSeconds: average(humanDeltas),
      overallSeconds: average([...aiDeltas, ...humanDeltas]),
      answered: aiDeltas.length + humanDeltas.length,
      unanswered: pendingByConversation.size,
    };
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}
