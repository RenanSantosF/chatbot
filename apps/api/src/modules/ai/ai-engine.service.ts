import { Inject, Injectable, Logger } from '@nestjs/common';
import { AiContextBuilder } from './ai-context-builder.service';
import { AiCredentialsResolver } from './providers/ai-credentials.resolver';
import {
  AI_PROVIDER,
  type AiProvider,
  type AiToolCallResult,
  type AiToolExecutor,
} from './providers/ai-provider.interface';
import { verificarResposta, type VerificacaoDaResposta } from './ai-guardrails';
import { AiToolsService } from './tools/ai-tools.service';

export interface AiReply {
  content: string;
  /** O que as travas concluíram sobre esta resposta (ver ai-guardrails). */
  verificacao: VerificacaoDaResposta;
}

/**
 * Por que a IA não respondeu — e não só *que* não respondeu.
 *
 * Antes isto era um `null` só. O resultado é que desligar a IA no meio de um
 * atendimento deixava o cliente falando sozinho: a mensagem era gravada, a
 * IA calava, e nada marcava a conversa como pendente de gente. Ninguém era
 * chamado porque ninguém sabia que precisava chamar.
 *
 * `indisponivel` é problema nosso (desligada, sem chave, provedor fora) e
 * precisa de um humano. `semPergunta` é normal — a última mensagem já era da
 * casa, não há nada a responder — e não deve acordar ninguém.
 */
/**
 * A chamada de ferramenta produziu efeito no mundo?
 *
 * Duas formas de "não": o executor recusou (sem permissão, ferramenta
 * desconhecida, exceção) e devolveu `error`; ou a ferramenta rodou mas se
 * recusou a agir e disse isso no `output` — é o caso da barreira de coleta
 * em transferToQueue, que responde `status: 'blocked'` justamente pra a IA
 * voltar e perguntar o que falta.
 */
export function executouDeVerdade(resultado: AiToolCallResult): boolean {
  if (resultado.error) return false;

  const saida = resultado.output;
  if (saida && typeof saida === 'object' && 'status' in saida) {
    const status = (saida as { status?: unknown }).status;
    if (status === 'blocked' || status === 'nothing_to_save') return false;
  }

  return true;
}

export type ResultadoDaIa =
  | { tipo: 'respondeu'; resposta: AiReply }
  | { tipo: 'indisponivel'; motivo: string }
  | { tipo: 'semPergunta' };

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
   * Decide se responde e, se sim, o quê. Quando não responde, diz por quê —
   * quem chama precisa saber se deve chamar um humano (ver ResultadoDaIa).
   * Erro de provedor nunca estoura daqui: quebrar o recebimento da mensagem
   * do cliente seria pior do que ficar sem resposta automática.
   */
  async generateReply(conversationId: string): Promise<ResultadoDaIa> {
    const { active, credentials } = await this.credentials.resolve();
    if (!active) {
      this.logger.log(
        `IA desativada pelo tenant — não respondendo a conversa ${conversationId}.`,
      );
      return {
        tipo: 'indisponivel',
        motivo: 'A IA está desligada nas configurações.',
      };
    }
    if (!credentials) {
      this.logger.warn('Sem API key de IA configurada.');
      return {
        tipo: 'indisponivel',
        motivo: 'A IA está sem chave de API configurada.',
      };
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
      return { tipo: 'semPergunta' };
    }

    this.logger.log(
      `Chamando o provedor de IA pra conversa ${conversationId}.`,
    );

    const toolDeclarations = await this.tools.getEnabledDeclarations();
    // Guardamos o que a IA de fato executou. É o que permite comparar a
    // promessa do texto com a ação — sem isso, "vou transferir" e uma
    // transferência real são indistinguíveis pro sistema.
    //
    // "De fato" é literal: só entra aqui a chamada que TERMINOU valendo.
    // Antes o nome era registrado antes de executar, e isso abria o buraco
    // exato que as travas existem pra fechar — uma transferência barrada
    // (sem permissão, ou sem os dados obrigatórios coletados) contava como
    // transferência feita, a trava se dava por satisfeita, e a conversa
    // ficava sem IA e sem gente, com o cliente já avisado de que alguém
    // assumiria.
    const usadas: string[] = [];
    const executeTool: AiToolExecutor | undefined =
      toolDeclarations.length > 0
        ? async (name, args) => {
            const resultado = await this.tools.execute(
              name,
              args,
              conversationId,
            );
            if (executouDeVerdade(resultado)) {
              usadas.push(name);
            }
            return resultado;
          }
        : undefined;

    try {
      const result = await this.provider.generateReply({
        ...context,
        ...credentials,
        tools: toolDeclarations,
        executeTool,
      });
      this.logger.log(`IA respondeu a conversa ${conversationId}.`);

      const ultimaDoCliente =
        [...context.history].reverse().find((m) => m.role === 'user')?.content ?? '';
      const verificacao = verificarResposta(result.content, ultimaDoCliente, usadas);

      if (verificacao.precisaHandoff || verificacao.prioridadeMinima) {
        this.logger.warn(
          `Trava da IA na conversa ${conversationId}: ${verificacao.motivo}`,
        );
      }

      return { tipo: 'respondeu', resposta: { content: result.content, verificacao } };
    } catch (error) {
      this.logger.warn(
        `IA não conseguiu responder a conversa ${conversationId}: ${error instanceof Error ? error.message : error}`,
      );
      return {
        tipo: 'indisponivel',
        motivo: 'A IA falhou ao responder (erro no provedor).',
      };
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
