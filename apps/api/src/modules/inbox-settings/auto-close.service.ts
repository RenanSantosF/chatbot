import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/** De hora em hora. A precisão do recurso é em horas; varrer mais que isso é gasto à toa. */
const INTERVALO_MS = 60 * 60 * 1000;

/**
 * Encerra sozinho os atendimentos que ficaram parados.
 *
 * Existe por causa da janela de atendimento do WhatsApp: passadas 24h sem
 * mensagem do cliente, responder deixa de ser livre e passa a exigir um
 * modelo aprovado pela Meta — que é burocrático e cobrado. Assunto que ficou
 * pendurado até estourar esse prazo vira um problema: ou some sem resposta,
 * ou custa dinheiro pra retomar.
 *
 * Por isso o padrão de fábrica é 20 horas: encerra com folga antes das 24,
 * enquanto ainda dá tempo de alguém reabrir de graça se quiser.
 *
 * O que este serviço deliberadamente NÃO faz é avisar o cliente. Encerrar é
 * uma decisão interna; disparar mensagem automática para muita gente de uma
 * vez é o tipo de coisa que a empresa tem que escolher mandar, não descobrir
 * que mandou. Quem quiser avisar, resolve a conversa pela tela — aí o aviso
 * de encerramento configurado é enviado normalmente.
 */
@Injectable()
export class AutoCloseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoCloseService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // `unref` pra este timer não segurar o processo de pé no encerramento —
    // sem isso o container demora a morrer e o deploy parece travado.
    this.timer = setInterval(() => {
      void this.varrer();
    }, INTERVALO_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Varre todos os tenants que ligaram o encerramento automático.
   *
   * Usa o client cru de propósito: é uma rotina de manutenção que roda sem
   * requisição, então não existe tenant "atual" pra TenantPrismaService
   * resolver. Em compensação, cada UPDATE carrega o tenantId da configuração
   * que o originou — o isolamento continua valendo, só que explícito.
   */
  async varrer() {
    const configs = await this.prisma.client.inboxSettings.findMany({
      where: { autoCloseIdle: true },
      select: { tenantId: true, autoCloseHours: true },
    });

    for (const config of configs) {
      const limite = new Date(Date.now() - config.autoCloseHours * 60 * 60 * 1000);

      const paradas = await this.prisma.client.conversation.findMany({
        where: {
          tenantId: config.tenantId,
          status: { in: ['OPEN', 'WAITING_CUSTOMER', 'WAITING_AGENT'] },
          lastMessageAt: { lt: limite },
        },
        select: { id: true },
      });
      if (paradas.length === 0) continue;

      const ids = paradas.map((c) => c.id);

      await this.prisma.client.conversation.updateMany({
        where: { id: { in: ids }, tenantId: config.tenantId },
        data: { status: 'RESOLVED' },
      });

      // Nota na conversa: quem abrir depois precisa saber que foi o sistema
      // que encerrou, e por quê — senão parece que um colega fechou sem
      // resolver.
      await this.prisma.client.message.createMany({
        data: ids.map((conversationId) => ({
          tenantId: config.tenantId,
          conversationId,
          senderType: 'SYSTEM' as const,
          messageType: 'TEXT' as const,
          content: `Encerrado automaticamente após ${config.autoCloseHours}h sem movimento.`,
        })),
      });

      this.logger.log(
        `Tenant ${config.tenantId}: ${ids.length} conversa(s) encerradas por inatividade.`,
      );
    }
  }
}
