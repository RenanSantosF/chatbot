import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { RetentionSweepService } from './retention-sweep.service';

/** Piso deliberado: menos de 7 dias apaga conversa que ainda está viva. */
const MIN_KEEP_DAYS = 7;

export interface UsageReport {
  /** Texto + arquivos. */
  usedBytes: number;
  textBytes: number;
  fileBytes: number;
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
    const salvo = await this.prisma.db.retentionSettings.update({
      where: { id: current.id },
      data: patch,
    });
    // Ligou a limpeza com a cota já estourada: libera agora, sem esperar a
    // próxima varredura (que pode estar a seis horas de distância).
    if (patch.autoPurgeOnFull) {
      void this.sweep
        .liberarEspaco(this.prisma.tenantId)
        .catch(() => undefined);
    }
    return salvo;
  }

  /**
   * Quanto a empresa ocupa, texto e arquivos (ver RetentionSweepService.medir,
   * que é a régua única — a da tela e a da varredura são a mesma).
   */
  async measureUsage(): Promise<UsageReport> {
    const tenantId = this.prisma.tenantId;
    const [medicao, conversas, clientes, billing] = await Promise.all([
      this.sweep.medir(tenantId),
      this.prisma.db.conversation.count(),
      this.prisma.db.customer.count(),
      this.getBilling(),
    ]);

    return {
      usedBytes: medicao.usedBytes,
      textBytes: medicao.textBytes,
      fileBytes: medicao.fileBytes,
      quotaBytes: Number(billing.quotaBytes),
      messages: medicao.messages,
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
    const deleted =
      (await this.sweep.purgarTenant(this.prisma.tenantId)) +
      (await this.sweep.liberarEspaco(this.prisma.tenantId));
    const usage = await this.measureUsage();
    return { deleted, usage };
  }
}
