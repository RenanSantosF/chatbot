import { Controller, Get, Query } from '@nestjs/common';
import { MetricsService } from './metrics.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;

/**
 * Aceita datas em ISO (yyyy-mm-dd ou timestamp completo). Qualquer coisa
 * inválida ou ausente cai no padrão dos últimos 30 dias em vez de dar erro
 * — é uma tela de leitura, não vale quebrar por causa de um parâmetro torto.
 */
function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  overview(@Query('from') from?: string, @Query('to') to?: string) {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);

    const parsedTo = parseDate(to, now);
    const parsedFrom = parseDate(from, defaultFrom);

    // Normaliza pras bordas do dia pra o período pedido incluir o dia
    // inteiro nas duas pontas, não só até o instante da requisição.
    parsedFrom.setHours(0, 0, 0, 0);
    parsedTo.setHours(23, 59, 59, 999);

    const start = parsedFrom <= parsedTo ? parsedFrom : parsedTo;
    const end = parsedFrom <= parsedTo ? parsedTo : parsedFrom;

    // Teto de janela: evita alguém pedir 10 anos e derrubar a query.
    const cappedStart =
      end.getTime() - start.getTime() > MAX_WINDOW_DAYS * DAY_MS
        ? new Date(end.getTime() - MAX_WINDOW_DAYS * DAY_MS)
        : start;

    return this.metricsService.overview({ from: cappedStart, to: end });
  }
}
