import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { destinatariosDaConversa } from '../conversations/destinatarios-da-conversa';
import { InboxSettingsService } from '../inbox-settings/inbox-settings.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { WhatsappMediaService } from '../whatsapp/whatsapp-media.service';
import { AiCredentialsResolver } from './providers/ai-credentials.resolver';
import {
  AiUsageService,
  TETO_DE_TRANSCRICOES_POR_MES,
} from './ai-usage.service';
import {
  AI_PROVIDER,
  type AiTranscriptionProvider,
} from './providers/ai-provider.interface';

/**
 * O maior áudio que a IA transcreve: ~600 KB, uns três a cinco minutos de
 * mensagem de voz do WhatsApp (Opus a 16–24 kbit/s).
 *
 * O Google cobra por segundo de áudio, e um áudio de vinte minutos custa
 * o mesmo que dezenas de respostas — quase sempre pra um recado que a
 * equipe vai ouvir de qualquer jeito. Acima disso, o áudio continua no
 * painel pra ouvir; só não vira texto.
 */
export const TAMANHO_MAXIMO_DO_AUDIO = 600 * 1024;

/**
 * O áudio do cliente virando texto.
 *
 * Duas regras diferentes convivem aqui, e a diferença entre elas é o
 * ponto do recurso inteiro:
 *
 * - Quando quem responde é a IA, transcrever é OBRIGATÓRIO e não passa por
 *   configuração nenhuma. Sem ouvir, ela não tem o que responder — a
 *   alternativa não é "economizar uma chamada", é atender pela metade.
 *
 * - Quando quem responde é gente, transcrever é conveniência: o atendente
 *   consegue ouvir. Aí a decisão é do dono (ver TranscricaoDeAudio), porque
 *   é ele quem paga a chamada ao modelo por áudio recebido.
 *
 * Nada aqui lança. Transcrição é enfeite em cima de uma mensagem que já
 * está gravada e já aparece no painel: falhar tem que degradar pro
 * comportamento antigo — o balão com o áudio e mais nada —, nunca derrubar
 * o recebimento.
 */
@Injectable()
export class TranscricaoService {
  private readonly logger = new Logger(TranscricaoService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly credenciais: AiCredentialsResolver,
    private readonly media: WhatsappMediaService,
    private readonly realtime: RealtimeGateway,
    private readonly inboxSettings: InboxSettingsService,
    @Inject(AI_PROVIDER) private readonly provider: AiTranscriptionProvider,
    private readonly uso: AiUsageService,
  ) {}

  /**
   * Transcreve, guarda e avisa a tela.
   *
   * Devolve o texto pra quem precisa dele na hora (a IA, montando o
   * contexto) e `null` quando não deu — sem exceção, de propósito.
   *
   * Se a mensagem já tem transcrição, ela volta sem custo nenhum: é o que
   * faz o botão do atendente ser barato depois de a IA já ter ouvido o
   * mesmo áudio, e o que impede o automático de pagar duas vezes.
   */
  async transcrever(messageId: string): Promise<string | null> {
    return (await this.transcreverComMotivo(messageId)).texto;
  }

  /**
   * O mesmo `transcrever`, dizendo por que não deu quando não deu — é o que
   * o botão do atendente mostra (teto do mês, áudio longo demais).
   */
  private async transcreverComMotivo(
    messageId: string,
  ): Promise<{ texto: string | null; motivo?: string }> {
    const nada = { texto: null };
    const mensagem = await this.prisma.db.message.findFirst({
      where: { id: messageId },
      select: {
        id: true,
        conversationId: true,
        messageType: true,
        mediaId: true,
        transcricao: true,
        deletedAt: true,
        metadata: true,
      },
    });

    if (!mensagem || mensagem.messageType !== 'AUDIO') return nada;
    // Apagada não se transcreve: seria recriar em texto o conteúdo que
    // alguém apagou justamente pra ele não ser lido de novo.
    if (mensagem.deletedAt) return nada;
    if (mensagem.transcricao) return { texto: mensagem.transcricao };
    if (!mensagem.mediaId) return nada;

    // Antes de baixar: o teto do mês barra sem gastar nem o download.
    if (!(await this.uso.cabe('transcricao'))) {
      this.logger.log(
        `Teto de ${TETO_DE_TRANSCRICOES_POR_MES} transcrições no mês atingido; áudio ${mensagem.id} fica sem texto.`,
      );
      return {
        texto: null,
        motivo: `A empresa já usou as ${TETO_DE_TRANSCRICOES_POR_MES} transcrições de áudio do mês. Elas renovam junto com as respostas da IA.`,
      };
    }

    const { credentials } = await this.credenciais.resolve();
    if (!credentials) {
      this.logger.warn(
        'Sem chave de IA configurada — o áudio não pôde ser transcrito.',
      );
      return nada;
    }

    let binario: { buffer: Buffer; mimeType: string };
    try {
      binario = await this.media.download(mensagem.mediaId);
    } catch (erro) {
      this.logger.warn(
        `Áudio não baixado pra transcrição: ${erro instanceof Error ? erro.message : erro}`,
      );
      return nada;
    }

    if (binario.buffer.length > TAMANHO_MAXIMO_DO_AUDIO) {
      return {
        texto: null,
        motivo:
          'Este áudio é longo demais pra transcrever. Dá pra ouvir normalmente no painel.',
      };
    }

    const texto = await this.provider.transcribe({
      buffer: binario.buffer,
      mimeType: binario.mimeType,
      ...credentials,
    });
    if (!texto) return nada;
    await this.uso.contar('transcricao').catch((erro: unknown) => {
      this.logger.warn(`Transcrição não contada no mês: ${String(erro)}`);
    });

    await this.prisma.db.message.update({
      where: { id: mensagem.id },
      data: { transcricao: texto },
    });

    // A tela precisa saber AGORA: no automático, o balão está aberto na
    // frente de alguém enquanto isto roda. Só quem pode ver a conversa,
    // pelo mesmo motivo de `ConversationsService.emitirParaConversa`.
    const conversation = await this.prisma.db.conversation.findFirst({
      where: { id: mensagem.conversationId },
      select: { queueId: true, assignedUserId: true },
    });
    if (conversation) {
      const settings = await this.inboxSettings.get();
      const destinatarios = await destinatariosDaConversa(
        this.prisma,
        conversation,
        settings.queueVisibility,
      );
      this.realtime.emitToUsers(destinatarios, 'message.transcrita', {
        conversationId: mensagem.conversationId,
        messageId: mensagem.id,
        transcricao: texto,
      });
    }

    return { texto };
  }

  /**
   * O caminho da chegada: transcreve só se a empresa pediu automático.
   *
   * Chamado sem `await` pelo recebimento, pelo mesmo motivo do
   * arquivamento de mídia: transcrever leva segundos, e o webhook que
   * demora é o webhook que a Evolution reenvia.
   *
   * O caminho da IA NÃO passa por aqui — ela transcreve sempre, na
   * montagem do contexto (ver AiContextBuilder).
   */
  async transcreverSeAutomatico(messageId: string): Promise<void> {
    const settings = await this.prisma.db.inboxSettings.findFirst({
      select: { transcricaoDeAudio: true },
    });
    if (settings?.transcricaoDeAudio !== 'AUTOMATICA') return;

    await this.transcrever(messageId);
  }

  /**
   * O botão do atendente.
   *
   * A checagem da configuração é aqui, no servidor, e não só no sumiço do
   * botão: DESLIGADA quer dizer "não quero pagar por isto", e um botão
   * escondido no CSS não segura ninguém que saiba montar um POST.
   *
   * `AUTOMATICA` também passa — a mensagem em geral já vem transcrita, e
   * aí a chamada devolve o que está guardado, de graça.
   */
  async transcreverAPedido(
    conversationId: string,
    messageId: string,
  ): Promise<{ transcricao: string | null; motivo?: string }> {
    const settings = await this.prisma.db.inboxSettings.findFirst({
      select: { transcricaoDeAudio: true },
    });
    if (settings?.transcricaoDeAudio === 'DESLIGADA') {
      throw new ForbiddenException(
        'A transcrição de áudio está desligada nas configurações da empresa.',
      );
    }

    // O id da conversa vem da URL: sem esta conferência, o messageId de
    // outra conversa do mesmo tenant seria transcrito por quem só tem
    // acesso a esta.
    const pertence = await this.prisma.db.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true },
    });
    if (!pertence) {
      throw new NotFoundException('Mensagem não encontrada nesta conversa.');
    }

    const { texto: transcricao, motivo } =
      await this.transcreverComMotivo(messageId);
    return {
      transcricao,
      ...(transcricao
        ? {}
        : {
            motivo:
              motivo ??
              'Não foi possível transcrever este áudio. Tente de novo em alguns instantes.',
          }),
    };
  }
}
