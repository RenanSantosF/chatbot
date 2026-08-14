import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';

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
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    /** Sem escopo de tenant: a varredura periódica roda pra todos. */
    private readonly root: PrismaService,
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
   * Apaga mensagens mais antigas que o prazo do tenant. Só mensagens: a
   * conversa e o cliente ficam, com o histórico esvaziado. Apagar a
   * conversa inteira quebraria relatório e faria o cliente parecer novo na
   * próxima vez que escrevesse.
   */
  async purgeTenant(tenantId: string): Promise<number> {
    const settings = await this.root.client.retentionSettings.findFirst({
      where: { tenantId },
    });
    if (!settings?.keepMessagesDays) return 0;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - settings.keepMessagesDays);

    const { count } = await this.root.client.message.deleteMany({
      where: { tenantId, createdAt: { lt: cutoff } },
    });

    if (count > 0) {
      this.logger.log(`Tenant ${tenantId}: ${count} mensagens apagadas por retenção.`);
    }

    await this.root.client.retentionSettings.update({
      where: { id: settings.id },
      data: { lastPurgeAt: new Date(), lastPurgeDeleted: count },
    });

    return count;
  }

  /** Varredura de todos os tenants que configuraram prazo. */
  async purgeAll(): Promise<{ tenants: number; deleted: number }> {
    const alvos = await this.root.client.retentionSettings.findMany({
      where: { keepMessagesDays: { not: null } },
      select: { tenantId: true },
    });

    let deleted = 0;
    for (const alvo of alvos) {
      try {
        deleted += await this.purgeTenant(alvo.tenantId);
      } catch (error) {
        // Um tenant com problema não pode parar a varredura dos outros.
        this.logger.error(
          `Falha na limpeza do tenant ${alvo.tenantId}: ${String(error)}`,
        );
      }
    }

    return { tenants: alvos.length, deleted };
  }

  /** Limpeza sob demanda, disparada pelo dono na tela. */
  async purgeNow() {
    const deleted = await this.purgeTenant(this.prisma.tenantId);
    const usage = await this.measureUsage();
    return { deleted, usage };
  }
}
