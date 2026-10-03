import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import * as evolution from '../whatsapp/canal/evolution/evolution.client';
import { empacotarId } from '../whatsapp/canal/evolution/evolution-id';

/** De hora em hora. A precisão do recurso é em horas; varrer mais que isso é gasto à toa. */
const INTERVALO_MS = 60 * 60 * 1000;

/**
 * Até quando a despedida ainda faz sentido.
 *
 * Nasceu como a janela de atendimento da Meta (fora dela, só modelo
 * aprovado e pago). Na Evolution essa regra não existe, mas o limite
 * continua valendo pelo outro motivo que ele sempre teve: é ele que impede
 * a primeira varredura de mandar "vamos encerrar por aqui" pro acervo
 * inteiro de uma vez — e rajada pra muita gente é exatamente o padrão que
 * faz o WhatsApp bloquear um número conectado por QR code.
 */
const JANELA_HORAS = 24;

/**
 * Encerra sozinho os atendimentos que ficaram parados.
 *
 * Existe por causa da janela de 24h: assunto que fica pendurado até estourar
 * esse prazo vira um problema que custa dinheiro pra retomar. O padrão
 * de fábrica é 2 horas: atendimento parado há duas horas já acabou, e
 * deixá-lo aberto até o dia seguinte só enche a fila.
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
 * - Necessária: mandar a despedida pra quem sumiu há dias é rajada sem
 *   contexto, e é o tipo de envio que põe o número em risco de bloqueio.
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
    private readonly realtime: RealtimeGateway,
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
          /*
           * Só quem deixou a EMPRESA esperando: ela respondeu por último e
           * o cliente não voltou.
           *
           * Antes valia qualquer conversa aberta parada — inclusive a do
           * cliente que escreveu e ficou sem resposta. Duas horas depois
           * ele recebia "vamos encerrar por aqui" de quem nunca respondeu,
           * e a conversa sumia da fila de quem devia atender. Esperando a
           * equipe (`waitingSince` preenchido, ou WAITING_AGENT), nunca
           * encerra sozinha.
           */
          status: 'WAITING_CUSTOMER',
          waitingSince: null,
          lastMessageAt: { lt: limite },
          // Grupo não é atendimento: não tem o que encerrar, e a tarja de
          // "encerrado automaticamente" no meio dele não faz sentido.
          customer: { isGroup: false },
        },
        select: {
          id: true,
          lastMessageAt: true,
          channel: true,
          customer: { select: { phone: true } },
        },
      });
      if (paradas.length === 0) continue;

      /*
       * Uma por uma, repetindo a condição no UPDATE.
       *
       * Entre a busca e o encerramento o cliente pode ter respondido — a
       * varredura passa por todas as empresas, e isso leva tempo. Um
       * `updateMany` só pelos ids encerrava a conversa que acabou de voltar
       * a pedir atendimento, e ela sumia da fila no exato momento em que
       * alguém precisava olhar pra ela.
       */
      const encerradas: typeof paradas = [];
      for (const conversa of paradas) {
        const { count } = await this.prisma.client.conversation.updateMany({
          where: {
            id: conversa.id,
            tenantId: config.tenantId,
            status: 'WAITING_CUSTOMER',
            waitingSince: null,
          },
          // O relógio de espera para junto: conversa encerrada não aguarda
          // resposta, e deixá-lo ligado a mantinha no contador de
          // "esperando" e no topo da fila. Mesmo motivo do `resolve` manual.
          data: { status: 'RESOLVED', waitingSince: null },
        });
        if (count > 0) encerradas.push(conversa);
      }
      if (encerradas.length === 0) continue;

      // Nota na conversa: quem abrir depois precisa saber que foi o sistema
      // que encerrou, e por quê — senão parece que um colega fechou sem
      // resolver.
      await this.prisma.client.message.createMany({
        data: encerradas.map((conversa) => ({
          tenantId: config.tenantId,
          conversationId: conversa.id,
          senderType: 'SYSTEM' as const,
          messageType: 'TEXT' as const,
          content: `Encerrado automaticamente após ${config.autoCloseHours}h sem resposta do cliente.`,
        })),
      });

      const avisadas = await this.avisar(config, encerradas, fimDaJanela);

      /*
       * O painel precisa saber.
       *
       * Sem isto a conversa encerrada continuava aberta na tela de quem
       * atende até recarregar a página — na aba "Aguardando cliente", com
       * o status velho no cabeçalho. Vai pra empresa inteira, só com os
       * ids: quem não enxerga a conversa recarrega a própria lista e não
       * vê nada a mais; o recorte de visibilidade continua sendo o da
       * listagem.
       */
      this.realtime.emitToTenant(config.tenantId, 'conversations.encerradas', {
        conversationIds: encerradas.map((conversa) => conversa.id),
      });

      this.logger.log(
        `Tenant ${config.tenantId}: ${encerradas.length} conversa(s) encerradas por inatividade` +
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

    /*
     * Pela Evolution, que é por onde todas as empresas falam.
     *
     * Este aviso saía pelo caminho oficial da Meta, que nenhuma empresa
     * usa: sem configuração dele a função voltava em silêncio, e a
     * despedida nunca chegou a ninguém. As credenciais são lidas aqui, e
     * não pelo EvolutionCanal, porque esta rotina roda sem requisição —
     * não existe tenant "atual" pro canal resolver.
     */
    const conexao = await this.prisma.client.evolutionSettings.findFirst({
      where: { tenantId: config.tenantId },
      select: {
        baseUrl: true,
        apiKeyEncrypted: true,
        instance: true,
        estado: true,
      },
    });
    // Sessão caída: encerra do mesmo jeito, só não tem como avisar.
    if (!conexao || conexao.estado !== 'CONECTADO') return 0;

    const credenciais: evolution.Credenciais = {
      baseUrl: conexao.baseUrl,
      apiKey: this.encryption.decrypt(conexao.apiKeyEncrypted),
      instance: conexao.instance,
    };
    let enviadas = 0;

    for (const conversa of dentroDaJanela) {
      const resposta = await evolution.enviarTexto(credenciais, {
        numero: conversa.customer.phone.replace(/\D/g, ''),
        texto,
      });
      const chave = resposta.dados?.key;

      if (!resposta.ok) {
        // Uma recusa não pode parar as outras: sessão caída derruba
        // todas, mas número inválido derruba só aquela — e distinguir os
        // dois casos aqui custaria mais do que tentar.
        this.logger.warn(
          `Aviso de encerramento não entregue na conversa ${conversa.id}: ${resposta.erro}`,
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
          // Com a chave, o tique de entregue/lido chega neste balão.
          externalId:
            chave?.id && chave.remoteJid
              ? empacotarId({
                  remoteJid: chave.remoteJid,
                  fromMe: chave.fromMe ?? true,
                  id: chave.id,
                })
              : null,
        },
      });
      enviadas += 1;
    }

    return enviadas;
  }
}
