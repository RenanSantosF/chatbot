import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { postarTexto } from '../whatsapp/meta-texto';

/** De hora em hora. A precisão do recurso é em horas; varrer mais que isso é gasto à toa. */
const INTERVALO_MS = 60 * 60 * 1000;

/**
 * A janela de atendimento do WhatsApp.
 *
 * Depois dela a Meta recusa texto livre: só passa modelo aprovado, que é
 * cobrado por mensagem. É o número que define o recurso inteiro.
 */
const JANELA_HORAS = 24;

/**
 * Encerra sozinho os atendimentos que ficaram parados.
 *
 * Existe por causa da janela de 24h: assunto que fica pendurado até estourar
 * esse prazo vira um problema que custa dinheiro pra retomar. Por isso o
 * padrão de fábrica é 20 horas — encerra com folga antes das 24, enquanto
 * ainda dá tempo de alguém reabrir de graça se quiser.
 *
 * O AVISO AO CLIENTE
 *
 * Este serviço não avisava ninguém, e o motivo declarado era o risco de
 * disparar mensagem automática pra muita gente de uma vez — a empresa
 * descobrindo que mandou, em vez de escolhendo mandar. A preocupação estava
 * certa; a conclusão, não. Sem aviso a conversa some só do nosso lado: o
 * cliente continua achando que tem alguém do outro lado e volta dias
 * depois cobrando uma resposta que, aqui dentro, já era assunto encerrado.
 *
 * O que resolve o risco não é ficar calado, é a própria janela: só recebe
 * aviso quem está DENTRO das 24h. Isso tem uma consequência boa e uma
 * necessária.
 *
 * - Necessária: fora da janela a Meta recusaria o texto livre de qualquer
 *   forma, e insistir seria pagar por uma despedida.
 * - Boa: na primeira varredura depois de ligar o recurso, o acervo antigo
 *   inteiro é encerrado EM SILÊNCIO. Só as conversas paradas há 20-24h
 *   recebem a mensagem, que são poucas por definição. O disparo em massa
 *   que se temia não tem por onde acontecer.
 */
@Injectable()
export class AutoCloseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoCloseService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

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
      select: {
        tenantId: true,
        autoCloseHours: true,
        autoCloseNotify: true,
        autoCloseMessage: true,
      },
    });

    for (const config of configs) {
      const agora = Date.now();
      const limite = new Date(agora - config.autoCloseHours * 60 * 60 * 1000);
      const fimDaJanela = new Date(agora - JANELA_HORAS * 60 * 60 * 1000);

      const paradas = await this.prisma.client.conversation.findMany({
        where: {
          tenantId: config.tenantId,
          status: { in: ['OPEN', 'WAITING_CUSTOMER', 'WAITING_AGENT'] },
          lastMessageAt: { lt: limite },
        },
        select: {
          id: true,
          lastMessageAt: true,
          channel: true,
          customer: { select: { phone: true } },
        },
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

      const avisadas = await this.avisar(config, paradas, fimDaJanela);

      this.logger.log(
        `Tenant ${config.tenantId}: ${ids.length} conversa(s) encerradas por inatividade` +
          (avisadas > 0 ? `, ${avisadas} com aviso ao cliente.` : '.'),
      );
    }
  }

  /**
   * Manda a despedida pra quem ainda está dentro da janela.
   *
   * @returns quantas mensagens saíram de fato
   */
  private async avisar(
    config: {
      tenantId: string;
      autoCloseNotify: boolean;
      autoCloseMessage: string;
    },
    paradas: {
      id: string;
      lastMessageAt: Date | null;
      channel: string;
      customer: { phone: string };
    }[],
    fimDaJanela: Date,
  ): Promise<number> {
    const texto = config.autoCloseMessage.trim();
    if (!config.autoCloseNotify || !texto) return 0;

    const dentroDaJanela = paradas.filter(
      (conversa) =>
        conversa.channel === 'WHATSAPP' &&
        conversa.lastMessageAt !== null &&
        conversa.lastMessageAt > fimDaJanela,
    );
    if (dentroDaJanela.length === 0) return 0;

    const whatsapp = await this.prisma.client.whatsAppSettings.findFirst({
      where: { tenantId: config.tenantId },
    });
    if (!whatsapp) return 0;

    const accessToken = this.encryption.decrypt(whatsapp.accessTokenEncrypted);
    let enviadas = 0;

    for (const conversa of dentroDaJanela) {
      const { wamid, erro } = await postarTexto({
        phoneNumberId: whatsapp.phoneNumberId,
        accessToken,
        to: conversa.customer.phone,
        body: texto,
      });

      if (erro) {
        // Uma recusa não pode parar as outras: token expirado derruba
        // todas, mas número inválido derruba só aquela — e distinguir os
        // dois casos aqui custaria mais do que tentar.
        this.logger.warn(
          `Aviso de encerramento não entregue na conversa ${conversa.id}: ${erro}`,
        );
        continue;
      }

      // Gravada como mensagem da empresa, igual ao aviso do "Resolver"
      // manual (ver ConversationsService.resolve): pro cliente as duas são
      // a mesma coisa, e o histórico precisa mostrar o que ele recebeu.
      await this.prisma.client.message.create({
        data: {
          tenantId: config.tenantId,
          conversationId: conversa.id,
          senderType: 'AGENT',
          messageType: 'TEXT',
          content: texto,
          status: 'SENT',
          externalId: wamid,
        },
      });
      enviadas += 1;
    }

    return enviadas;
  }
}
