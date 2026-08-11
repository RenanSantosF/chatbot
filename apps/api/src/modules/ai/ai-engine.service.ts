import { Inject, Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { AiContextBuilder } from './ai-context-builder.service';
import { AI_PROVIDER, type AiProvider } from './providers/ai-provider.interface';

/**
 * O "cérebro": decide se responde e, se sim, o quê. Nunca escreve no banco
 * nem mexe em Socket.io — isso é responsabilidade de quem chama
 * (ConversationsService), que trata a resposta da IA exatamente como
 * trataria a de um atendente humano.
 */
@Injectable()
export class AiEngineService {
  private readonly logger = new Logger(AiEngineService.name);

  constructor(
    private readonly contextBuilder: AiContextBuilder,
    private readonly tenantPrisma: TenantPrismaService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  /**
   * Retorna o texto da resposta, ou null quando a IA não deve responder
   * (desligada pelo tenant, ou falha na chamada ao provedor — nesse caso o
   * atendimento simplesmente fica visível pra um humano assumir, em vez de
   * quebrar o recebimento da mensagem do cliente).
   */
  async generateReply(conversationId: string): Promise<string | null> {
    const settings = await this.tenantPrisma.db.aiSettings.findFirst();
    if (settings && !settings.active) {
      return null;
    }

    const context = await this.contextBuilder.build(conversationId);

    if (context.history.length === 0 || context.history[context.history.length - 1].role !== 'user') {
      // Não tem mensagem de cliente pra responder (ex: última mensagem já é da IA/atendente).
      return null;
    }

    try {
      const result = await this.provider.generateReply(context);
      return result.content;
    } catch (error) {
      this.logger.warn(
        `IA não conseguiu responder a conversa ${conversationId}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /**
   * Usado pelo simulador de teste (/ai/simulate). Diferente de
   * generateReply, deixa o erro estourar — aqui o dono está testando de
   * propósito e precisa ver se a chave/config está errada, não receber um
   * silêncio educado.
   */
  async simulate(message: string): Promise<string> {
    const context = await this.contextBuilder.buildStandalone(message);
    const result = await this.provider.generateReply(context);
    return result.content;
  }
}
