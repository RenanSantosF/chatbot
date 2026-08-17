import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * De seis em seis horas.
 *
 * O prazo de guarda é medido em DIAS, então varrer de hora em hora seria
 * gasto sem ganho: quatro passadas por dia deixam a conta em dia com folga
 * e distribuem o apagamento em lotes menores.
 */
const INTERVALO_MS = 6 * 60 * 60 * 1000;

/**
 * Espera antes da primeira varredura.
 *
 * A subida do processo já é o momento mais carregado — migração, conexão
 * de banco, reconexão dos sockets. Um DELETE em massa competindo com isso
 * atrasa justamente o que a pessoa está olhando: o painel voltando.
 */
const ATRASO_INICIAL_MS = 5 * 60 * 1000;

/**
 * A varredura que faz o prazo de guarda valer.
 *
 * ELA NÃO EXISTIA, e essa é a razão deste arquivo. `purgeAll` estava
 * escrito, testado e completo dentro do RetentionService — e ninguém o
 * chamava. A tela de armazenamento dizia "passado o prazo, as mensagens
 * são apagadas", o prazo passava, e nada era apagado. Só o botão "Limpar
 * agora" funcionava, o que transforma uma política de retenção em uma
 * tarefa manual que ninguém lembra de fazer.
 *
 * Por que uma classe à parte, e não um timer no RetentionService: aquele
 * serviço injeta o TenantPrismaService e por isso tem ESCOPO DE
 * REQUISIÇÃO — o Nest cria uma instância por chamada HTTP. Um serviço
 * assim não tem onde pendurar um timer, e é essa a explicação de o
 * `purgeAll` ter nascido órfão: não havia de onde chamá-lo. Aqui o
 * escopo é o do processo, como no AutoCloseService, e o isolamento
 * continua explícito — cada consulta carrega o tenantId da configuração
 * que a originou.
 */
@Injectable()
export class RetentionSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionSweepService.name);
  private timer?: NodeJS.Timeout;
  private primeira?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // `unref` nos dois pra nenhum deles segurar o processo de pé no
    // encerramento — sem isso o container demora a morrer e o deploy
    // parece travado.
    this.primeira = setTimeout(() => {
      void this.varrer();
      this.timer = setInterval(() => void this.varrer(), INTERVALO_MS);
      this.timer.unref();
    }, ATRASO_INICIAL_MS);
    this.primeira.unref();
  }

  onModuleDestroy() {
    if (this.primeira) clearTimeout(this.primeira);
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Apaga mensagens mais antigas que o prazo do tenant.
   *
   * Só mensagens: a conversa e o cliente ficam, com o histórico esvaziado.
   * Apagar a conversa inteira quebraria relatório e faria o cliente
   * parecer novo na próxima vez que escrevesse.
   */
  async purgarTenant(tenantId: string): Promise<number> {
    const settings = await this.prisma.client.retentionSettings.findFirst({
      where: { tenantId },
    });
    if (!settings?.keepMessagesDays) return 0;

    const corte = new Date();
    corte.setDate(corte.getDate() - settings.keepMessagesDays);

    const { count } = await this.prisma.client.message.deleteMany({
      where: { tenantId, createdAt: { lt: corte } },
    });

    if (count > 0) {
      this.logger.log(
        `Tenant ${tenantId}: ${count} mensagens apagadas por retenção.`,
      );
    }

    await this.prisma.client.retentionSettings.update({
      where: { id: settings.id },
      data: { lastPurgeAt: new Date(), lastPurgeDeleted: count },
    });

    return count;
  }

  /** Varredura de todos os tenants que configuraram prazo. */
  async varrer(): Promise<{ tenants: number; deleted: number }> {
    const alvos = await this.prisma.client.retentionSettings.findMany({
      where: { keepMessagesDays: { not: null } },
      select: { tenantId: true },
    });

    let deleted = 0;
    for (const alvo of alvos) {
      try {
        deleted += await this.purgarTenant(alvo.tenantId);
      } catch (error) {
        // Um tenant com problema não pode parar a varredura dos outros.
        this.logger.error(
          `Falha na limpeza do tenant ${alvo.tenantId}: ${String(error)}`,
        );
      }
    }

    if (deleted > 0) {
      this.logger.log(
        `Varredura de retenção: ${deleted} mensagens apagadas em ${alvos.length} empresas.`,
      );
    }

    return { tenants: alvos.length, deleted };
  }
}
