import { Inject, Injectable, Logger } from '@nestjs/common';
import { AiContextBuilder } from './ai-context-builder.service';
import { AiCredentialsResolver } from './providers/ai-credentials.resolver';
import {
  AI_PROVIDER,
  type AiProvider,
  type AiToolExecutor,
} from './providers/ai-provider.interface';
import { AiToolsService } from './tools/ai-tools.service';

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
    private readonly credentials: AiCredentialsResolver,
    private readonly tools: AiToolsService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  /**
   * Retorna o texto da resposta, ou null quando a IA não deve responder
   * (desligada pelo tenant, sem API key configurada, ou falha na chamada ao
   * provedor — nesses casos o atendimento simplesmente fica visível pra um
   * humano assumir, em vez de quebrar o recebimento da mensagem do
   * cliente).
   */
  async generateReply(conversationId: string): Promise<string | null> {
    const { active, credentials } = await this.credentials.resolve();
    if (!active) {
      this.logger.log(
        `IA desativada pelo tenant — não respondendo a conversa ${conversationId}.`,
      );
      return null;
    }
    if (!credentials) {
      this.logger.warn('Sem API key de IA configurada.');
      return null;
    }

    const context = await this.contextBuilder.build(conversationId);

    if (
      context.history.length === 0 ||
      context.history[context.history.length - 1].role !== 'user'
    ) {
      // Não tem mensagem de cliente pra responder (ex: última mensagem já é da IA/atendente).
      this.logger.log(
        `Sem mensagem de cliente pra responder na conversa ${conversationId}.`,
      );
      return null;
    }

    this.logger.log(
      `Chamando o provedor de IA pra conversa ${conversationId}.`,
    );

    const toolDeclarations = await this.tools.getEnabledDeclarations();
    const executeTool: AiToolExecutor | undefined =
      toolDeclarations.length > 0
        ? (name, args) => this.tools.execute(name, args, conversationId)
        : undefined;

    try {
      const result = await this.provider.generateReply({
        ...context,
        ...credentials,
        tools: toolDeclarations,
        executeTool,
      });
      this.logger.log(`IA respondeu a conversa ${conversationId}.`);
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
   * silêncio educado. De propósito não passa ferramentas: o simulador testa
   * a personalidade/prompt, não deve criar tarefa ou disparar handoff de
   * verdade sem uma conversa real por trás.
   */
  async simulate(message: string): Promise<string> {
    const { credentials } = await this.credentials.resolve();
    if (!credentials) {
      throw new Error(
        'Nenhuma API key de IA configurada. Adicione uma em Configurações > IA.',
      );
    }

    const context = await this.contextBuilder.buildStandalone(message);
    const result = await this.provider.generateReply({
      ...context,
      ...credentials,
    });
    return result.content;
  }
}
