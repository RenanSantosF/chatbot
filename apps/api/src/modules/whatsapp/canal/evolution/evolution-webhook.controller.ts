import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import type { Prisma } from '../../../../../generated/prisma/client';
import { Public } from '../../../../common/auth/public.decorator';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AuthenticatedRequest } from '../../../auth/auth.types';
import { ConversationsService } from '../../../conversations/conversations.service';
import { empacotarId, telefoneDoJid } from './evolution-id';
import {
  comoLista,
  horaDaMensagem,
  traduzirMensagem,
  traduzirStatus,
  type DadosDaMensagem,
  type EventoDaEvolution,
} from './evolution-mensagem';

/**
 * Onde a Evolution entrega o que chega no WhatsApp.
 *
 * A autenticação é o segredo no caminho da URL, e não uma assinatura como
 * a da Meta: a Evolution não assina as entregas. É menos do que se
 * gostaria, e por isso o segredo tem 24 bytes aleatórios, é por empresa, e
 * a comparação é em tempo constante — sem isso, o tempo de resposta
 * revelaria o segredo caractere por caractere.
 */
// Sem limite de requisições, mesma razão do webhook da Meta: mensagem
// chega em rajada, e barrar aqui derrubaria o recebimento pra defender de
// um ataque que o segredo já barra.
@SkipThrottle()
@Controller('webhooks/evolution')
export class EvolutionWebhookController {
  private readonly logger = new Logger(EvolutionWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
  ) {}

  @Public()
  @Post(':secret')
  @HttpCode(HttpStatus.OK)
  async receber(
    @Param('secret') secret: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: EventoDaEvolution,
  ) {
    const config = await this.acharPeloSegredo(secret);
    if (!config) {
      throw new ForbiddenException('Segredo inválido.');
    }

    // O nome da sessão vem em todo evento. Conferir contra o que está
    // gravado pega o caso de um servidor mal configurado apontando duas
    // sessões pra mesma URL — que criaria mensagem de uma empresa dentro
    // do painel de outra.
    if (body.instance && body.instance !== config.instance) {
      this.logger.warn(
        `Evento da sessão ${body.instance} chegou pela URL da sessão ${config.instance}; ignorado.`,
      );
      return { ok: true };
    }

    // Mesmo truque do webhook da Meta: um "usuário" sintético pro resto do
    // caminho (TenantPrismaService) resolver a empresa certa. Quem
    // autenticou esta requisição foi o segredo da URL.
    req.user = {
      userId: 'evolution-webhook',
      tenantId: config.tenantId,
      role: 'OWNER',
      email: 'webhook@evolution',
      name: 'WhatsApp',
    };

    const evento = body.event?.toUpperCase().replace(/\./g, '_');
    switch (evento) {
      case 'MESSAGES_UPSERT':
        await this.mensagens(body, config);
        break;
      case 'MESSAGES_UPDATE':
        await this.statusDeEntrega(body);
        break;
      case 'CONNECTION_UPDATE':
        await this.conexao(body, config);
        break;
      case 'QRCODE_UPDATED':
        await this.qrCode(body, config);
        break;
      default:
        this.logger.debug(`Evento ignorado: ${body.event ?? 'sem nome'}`);
    }

    // Sempre 200, como no caminho oficial: a Evolution reenvia quando não
    // recebe, e um lote reenviado é mensagem duplicada no painel.
    return { ok: true };
  }

  private async acharPeloSegredo(secret: string) {
    // Só busca no banco depois de conferir o formato: sem isto, qualquer
    // string vira uma consulta, e o endereço do webhook é público.
    if (!/^[0-9a-f]{48}$/.test(secret)) return null;

    const config = await this.prisma.client.evolutionSettings.findFirst({
      where: { webhookSecret: secret },
    });
    if (!config) return null;

    // A consulta acima já é por igualdade exata, mas a comparação em tempo
    // constante fica de guarda pro dia em que a busca virar algo mais
    // esperto (prefixo, cache) e o tempo passar a contar história.
    const esperado = Buffer.from(config.webhookSecret);
    const recebido = Buffer.from(secret);
    if (esperado.length !== recebido.length) return null;
    return timingSafeEqual(esperado, recebido) ? config : null;
  }

  private async mensagens(
    body: EventoDaEvolution,
    config: { tenantId: string; id: string },
  ) {
    for (const dados of comoLista(body.data)) {
      const chave = dados.key;
      if (!chave?.id || !chave.remoteJid) continue;

      const telefone = telefoneDoJid(chave.remoteJid);
      if (!telefone) {
        // Grupo, lista de transmissão, status. Nenhum deles é atendimento
        // individual, e tratar como se fosse criaria um "cliente" com o id
        // do grupo misturando o que várias pessoas escreveram.
        continue;
      }

      const traduzida = traduzirMensagem(dados);
      if (!traduzida) {
        this.logger.warn(
          `Tipo de mensagem não suportado na sessão ${config.id}: ${Object.keys(dados.message ?? {}).join(', ')}`,
        );
        continue;
      }

      const externalId = empacotarId({
        remoteJid: chave.remoteJid,
        fromMe: chave.fromMe ?? false,
        id: chave.id,
      });

      // Mensagem escrita pelo celular da própria empresa. Sem tratar isto,
      // o painel mostraria a pergunta e nunca a resposta — e a IA
      // responderia por cima de quem já respondeu. É o mesmo problema dos
      // ecos de coexistência no caminho oficial, e aqui ele é a REGRA:
      // conexão por aparelho vinculado significa que o celular continua na
      // mão de alguém.
      if (chave.fromMe) {
        await this.conversations.recordOutboundEcho({
          customerPhone: telefone,
          content: traduzida.content,
          messageType: traduzida.messageType,
          metadata: traduzida.metadata as Prisma.InputJsonValue | undefined,
          externalId,
        });
        continue;
      }

      await this.conversations.receiveInbound({
        customerPhone: telefone,
        customerName: dados.pushName ?? telefone,
        content: traduzida.content,
        messageType: traduzida.messageType,
        metadata: traduzida.metadata as Prisma.InputJsonValue | undefined,
        channel: 'WHATSAPP',
        externalId,
        replyToExternalId: traduzida.citando
          ? empacotarId({
              remoteJid: chave.remoteJid,
              // A citação aponta pra uma mensagem NOSSA na esmagadora
              // maioria das vezes: o cliente está respondendo o que a
              // empresa escreveu.
              fromMe: true,
              id: traduzida.citando,
            })
          : undefined,
        createdAt: horaDaMensagem(dados),
      });
    }
  }

  private async statusDeEntrega(body: EventoDaEvolution) {
    for (const dados of comoLista(body.data)) {
      const chave = dados.key;
      if (!chave?.id || !chave.remoteJid) continue;

      const estado = traduzirStatus(dados.status);
      if (!estado) continue;

      await this.conversations.applyDeliveryStatus(
        empacotarId({
          remoteJid: chave.remoteJid,
          fromMe: chave.fromMe ?? true,
          id: chave.id,
        }),
        estado,
      );
    }
  }

  private async conexao(
    body: EventoDaEvolution,
    config: { id: string; instance: string },
  ) {
    const dados = body.data as { state?: string; statusReason?: number } | undefined;
    const bruto = dados?.state;

    const estado =
      bruto === 'open'
        ? ('CONECTADO' as const)
        : bruto === 'connecting'
          ? ('AGUARDANDO_QRCODE' as const)
          : ('DESCONECTADO' as const);

    await this.prisma.client.evolutionSettings.update({
      where: { id: config.id },
      data: {
        estado,
        ...(estado === 'CONECTADO'
          ? { lastSeenAt: new Date(), qrCode: null, lastError: null }
          : {}),
        ...(estado === 'DESCONECTADO'
          ? {
              // O código de motivo é o que separa "o celular ficou sem
              // internet" de "o WhatsApp desvinculou o aparelho" — e só o
              // segundo exige ler o QR code de novo.
              lastError:
                dados?.statusReason === 401
                  ? 'o aparelho foi desvinculado no WhatsApp; leia o QR code de novo'
                  : 'a sessão caiu no servidor de mensagens',
            }
          : {}),
      },
    });

    this.logger.log(`Sessão ${config.instance}: ${estado}.`);
  }

  private async qrCode(
    body: EventoDaEvolution,
    config: { id: string },
  ) {
    const dados = body.data as { qrcode?: { base64?: string }; base64?: string } | undefined;
    const qrCode = dados?.qrcode?.base64 ?? dados?.base64;
    if (!qrCode) return;

    await this.prisma.client.evolutionSettings.update({
      where: { id: config.id },
      data: { qrCode, estado: 'AGUARDANDO_QRCODE' },
    });
  }
}
