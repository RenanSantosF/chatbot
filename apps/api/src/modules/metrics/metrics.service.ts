import { Injectable } from '@nestjs/common';
import type {
  ConversationStatus,
  MessageSenderType,
} from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { meiaNoite, partes } from '../../common/utils/fuso';
import { fusoValido } from '../inbox-settings/horario-comercial';

export interface MetricsRange {
  from: Date;
  to: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;

/** O dia (aaaa-mm-dd) em que `date` cai no relógio da empresa. */
function dayKey(date: Date, fuso: string): string {
  const { ano, mes, dia } = partes(fuso, date);
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * A meia-noite, no fuso da empresa, do dia escrito em `valor`.
 *
 * A tela manda o dia do calendário ("2026-10-03"), e `new Date` leria isso
 * como meia-noite UTC — 21h do dia anterior em São Paulo. Ancorar ao
 * meio-dia UTC cai no mesmo dia em qualquer fuso habitado.
 */
function inicioDoDia(
  valor: string | undefined,
  fuso: string,
  padrao: Date,
): Date {
  const dia = valor && /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  if (dia) {
    const [, ano, mes, d] = dia.map(Number);
    return meiaNoite(fuso, new Date(Date.UTC(ano, mes - 1, d, 12)));
  }
  const data = valor ? new Date(valor) : padrao;
  return meiaNoite(fuso, Number.isNaN(data.getTime()) ? padrao : data);
}

/** Média e contagem por nota — o que a Visão geral e o resumo mostram. */
export function resumoDasAvaliacoes(notas: number[]) {
  const porNota = [1, 2, 3, 4, 5].map(
    (nota) => notas.filter((n) => n === nota).length,
  );
  return {
    total: notas.length,
    media: notas.length
      ? Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 10) / 10
      : null,
    porNota,
  };
}

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: TenantPrismaService) {}

  /**
   * O período pedido, com as bordas no relógio da EMPRESA.
   *
   * Era o relógio do servidor (UTC): "hoje" ia das 21h de ontem às 21h de
   * hoje pra quem está em São Paulo, e o movimento da noite aparecia no
   * dia seguinte. Qualquer coisa inválida ou ausente cai no padrão dos
   * últimos 30 dias em vez de dar erro — é uma tela de leitura.
   */
  async periodo(
    de?: string,
    ate?: string,
  ): Promise<MetricsRange & { fuso: string }> {
    const tenant = await this.prisma.db.tenant.findUnique({
      where: { id: this.prisma.tenantId },
      select: { timezone: true },
    });
    const fuso = fusoValido(tenant?.timezone ?? 'America/Sao_Paulo');

    const agora = new Date();
    const inicio = inicioDoDia(
      de,
      fuso,
      new Date(agora.getTime() - (DEFAULT_WINDOW_DAYS - 1) * DAY_MS),
    );
    const ultimoDia = inicioDoDia(ate, fuso, agora);
    const [primeiro, ultimo] =
      inicio <= ultimoDia ? [inicio, ultimoDia] : [ultimoDia, inicio];
    // O último dia inteiro: até o instante antes da meia-noite seguinte.
    // Somar 36h e voltar pra meia-noite atravessa horário de verão sem
    // errar de dia.
    const fim = new Date(
      meiaNoite(
        fuso,
        new Date(ultimo.getTime() + 36 * 60 * 60 * 1000),
      ).getTime() - 1,
    );

    // Teto de janela: evita alguém pedir 10 anos e derrubar a query.
    const from =
      fim.getTime() - primeiro.getTime() > MAX_WINDOW_DAYS * DAY_MS
        ? new Date(fim.getTime() - MAX_WINDOW_DAYS * DAY_MS)
        : primeiro;

    return { from, to: fim, fuso };
  }

  /**
   * Tudo que a Visão geral mostra, num request só e sempre recortado pelo
   * período pedido. As contas são feitas em memória de propósito: o volume
   * por tenant é pequeno (milhares de mensagens), e assim o cálculo de
   * tempo de resposta — que precisa parear cada mensagem de cliente com a
   * resposta seguinte — fica legível em vez de virar SQL de janela.
   */
  async overview(range: MetricsRange, fuso = 'UTC') {
    const [conversations, messages, avaliacoes] = await Promise.all([
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
      this.prisma.db.avaliacaoDeAtendimento.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        select: { nota: true },
      }),
    ]);

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      totals: this.buildTotals(conversations, messages),
      byDay: this.buildByDay(range, conversations, messages, fuso),
      byStatus: this.buildByStatus(conversations),
      responseTime: this.buildResponseTime(messages),
      avaliacoes: resumoDasAvaliacoes(avaliacoes.map((a) => a.nota)),
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
    fuso: string,
  ) {
    const days = new Map<
      string,
      { day: string; conversations: number; messages: number }
    >();

    // Semeia todos os dias do período, inclusive os vazios — sem isso o
    // gráfico "pula" os dias sem movimento e distorce a leitura da linha.
    //
    // A contagem anda de meio-dia em meio-dia, no fuso da empresa, e para
    // pelo NOME do dia, não pelo instante. Somar 24h a partir de um horário
    // quebrado e comparar com o fim fazia o laço parar antes do último dia
    // sempre que o fim caía mais cedo no relógio que o começo: o dia
    // existia, tinha movimento, e sumia do gráfico. O meio-dia também não
    // troca de dia com horário de verão.
    const ultimoDia = dayKey(range.to, fuso);
    for (
      let t = meiaNoite(fuso, range.from).getTime() + DAY_MS / 2;
      dayKey(new Date(t), fuso) <= ultimoDia;
      t += DAY_MS
    ) {
      const key = dayKey(new Date(t), fuso);
      days.set(key, { day: key, conversations: 0, messages: 0 });
    }

    for (const conversation of conversations) {
      const bucket = days.get(dayKey(conversation.createdAt, fuso));
      if (bucket) bucket.conversations += 1;
    }
    for (const message of messages) {
      const bucket = days.get(dayKey(message.createdAt, fuso));
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
