import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { RetentionSweepService } from './retention-sweep.service';

/** Piso deliberado: menos de 7 dias apaga conversa que ainda está viva. */
const MIN_KEEP_DAYS = 7;

export interface UsageReport {
  usedBytes: number;
  quotaBytes: number;
  messages: number;
  conversations: number;
  customers: number;
  measuredAt: string;
}

@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: TenantPrismaService,
    /** Sem escopo de tenant: a medição usa SQL cru com o tenantId explícito. */
    private readonly root: PrismaService,
    private readonly sweep: RetentionSweepService,
  ) {}

  async getSettings() {
    const existing = await this.prisma.db.retentionSettings.findFirst();
    if (existing) return existing;
    return this.prisma.db.retentionSettings.create({
      data: { tenantId: this.prisma.tenantId },
    });
  }

  async getBilling() {
    const existing = await this.prisma.db.billingAccount.findFirst();
    if (existing) return existing;
    return this.prisma.db.billingAccount.create({
      data: { tenantId: this.prisma.tenantId },
    });
  }

  async updateSettings(patch: {
    keepMessagesDays?: number | null;
    autoPurgeOnFull?: boolean;
  }) {
    if (
      patch.keepMessagesDays !== undefined &&
      patch.keepMessagesDays !== null &&
      patch.keepMessagesDays < MIN_KEEP_DAYS
    ) {
      // BadRequest, não Error cru: um Error solto sai como 500 e a tela
      // mostra "erro interno" pra quem só digitou um número baixo demais.
      throw new BadRequestException(`O mínimo é ${MIN_KEEP_DAYS} dias.`);
    }
    const current = await this.getSettings();
    return this.prisma.db.retentionSettings.update({
      where: { id: current.id },
      data: patch,
    });
  }

  /**
   * Mede o espaço de verdade, perguntando ao Postgres o tamanho das linhas
   * deste tenant — não uma estimativa por "tantos bytes por mensagem".
   * `pg_column_size` soma o que cada campo realmente ocupa, incluindo o
   * JSON de metadados, que é onde a variação mora.
   *
   * Dois detalhes de SQL cru, que não passa pelo mapeamento do Prisma: o
   * nome da tabela é o físico (`messages`, não `Message`), e o tenantId é
   * `text` no banco — comparar com `::uuid` quebra.
   */
  async measureUsage(): Promise<UsageReport> {
    const tenantId = this.prisma.tenantId;

    const [linha] = await this.root.client.$queryRaw<
      { bytes: bigint; total: bigint }[]
    >`
      SELECT COALESCE(SUM(pg_column_size(m.*)), 0)::bigint AS bytes,
             COUNT(*)::bigint AS total
      FROM messages m
      WHERE m."tenantId" = ${tenantId}
    `;

    const [conversas, clientes] = await Promise.all([
      this.prisma.db.conversation.count(),
      this.prisma.db.customer.count(),
    ]);

    const billing = await this.getBilling();
    const usedBytes = Number(linha?.bytes ?? 0n);

    await this.prisma.db.billingAccount.update({
      where: { id: billing.id },
      data: { usedBytes: BigInt(usedBytes), measuredAt: new Date() },
    });

    return {
      usedBytes,
      quotaBytes: Number(billing.quotaBytes),
      messages: Number(linha?.total ?? 0n),
      conversations: conversas,
      customers: clientes,
      measuredAt: new Date().toISOString(),
    };
  }

  /**
   * Limpeza sob demanda, disparada pelo dono na tela.
   *
   * O apagamento em si mora no RetentionSweepService, junto da varredura
   * periódica. Duas cópias da mesma regra — uma pro botão, outra pro
   * relógio — divergiriam na primeira vez que alguém mexesse em uma delas,
   * e o jeito de descobrir seria pela diferença entre o que a tela apaga e
   * o que a madrugada apaga.
   */
  async purgeNow() {
    const deleted = await this.sweep.purgarTenant(this.prisma.tenantId);
    const usage = await this.measureUsage();
    return { deleted, usage };
  }
}
