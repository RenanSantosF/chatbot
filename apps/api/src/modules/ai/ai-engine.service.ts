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
import { porQueAIaNaoRespondeu } from './ai-indisponivel';
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

/**
 * O que dizer quando a IA agiu e não escreveu nada.
 *
 * Nasceu de um silêncio real: a IA transferiu a conversa pro setor certo,
 * pelo motivo certo, e não mandou uma palavra ao cliente. Pra quem estava
 * do outro lado, era uma pergunta ignorada.
 *
 * A frase sai do que foi EXECUTADO, e por isso é sempre verdadeira. Vazio
 * quando nada foi executado: aí não há o que anunciar, e inventar uma
 * cortesia genérica só empurraria o problema pro cliente.
 */
export function textoDeCortesia(ferramentas: string[]): string {
  if (ferramentas.includes('transferToQueue')) {
    return (
      'Vou confirmar essa informação com a equipe pra não te passar nada errado. ' +
      'Já chamei alguém pra continuar seu atendimento por aqui.'
    );
  }
  if (ferramentas.includes('resolveConversation')) {
    return 'Atendimento encerrado por aqui. Se precisar de mais alguma coisa, é só chamar!';
  }
  return '';
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
   * A IA desta empresa tem condição de atender AGORA?
   *
   * Ligada E com credencial. As duas coisas, porque "ligada sem chave" é o
   * estado mais comum de uma conta nova e é indistinguível de desligada
   * do ponto de vista do cliente — em nenhum dos dois casos vai sair
   * resposta.
   *
   * Serve pra decidir o `aiMode` da conversa no momento em que ela nasce
   * (ver ConversationsService.receiveInbound). Sem esta pergunta, toda
   * conversa nascia AI_ACTIVE pelo padrão do banco, inclusive numa empresa
   * que nunca configurou IA nenhuma.
   */
  async podeAtender(): Promise<boolean> {
    return (await this.diagnostico()).pode;
  }

  /**
   * A mesma pergunta, com o motivo — pra quem precisa explicar o "não".
   *
   * Existe porque a resposta estava sendo REMONTADA fora daqui. Três
   * lugares consultavam `aiSettings` por conta própria e concluíam
   * "active && apiKeyEncrypted", que não é a mesma regra: o resolvedor
   * trata a ausência da linha como ligada, e aceita a chave de ambiente
   * quando o tenant não tem a própria. Onde as duas discordavam, o sistema
   * se contradizia — a conversa nova ganhava IA e a REABERTA não, com o
   * cliente escrevendo pra ninguém.
   *
   * Quem precisa só do sim/não usa `podeAtender`. Este aqui é pra quem vai
   * escrever o motivo na tela.
   */
  async diagnostico(): Promise<{
    pode: boolean;
    motivo?: 'desligada' | 'sem-chave';
  }> {
    const { active, credentials } = await this.credentials.resolve();
    if (!active) return { pode: false, motivo: 'desligada' };
    if (!credentials) return { pode: false, motivo: 'sem-chave' };
    return { pode: true };
  }

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
        // O motivo aparece no painel em "por que veio pra equipe", e é a
        // primeira coisa que quem vai atender lê. Descreve o CASO, não o
        // estado interno do sistema: "A IA falhou (erro no provedor)"
        // soava alarme de incidente numa conversa que era só um "oi" sem
        // resposta — e, numa demonstração pra cliente, deprecia o produto
        // sem necessidade. O detalhe técnico continua no log, que é onde
        // ele serve pra alguma coisa.
        motivo: 'O atendimento automático está desligado e o cliente está esperando.',
      };
    }
    if (!credentials) {
      this.logger.warn('Sem API key de IA configurada.');
      return {
        tipo: 'indisponivel',
        motivo: 'O atendimento automático ainda não foi configurado e o cliente está esperando.',
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

      /*
       * A IA agiu e não falou. Alguém precisa falar.
       *
       * O caso real: o cliente perguntou o endereço, a IA transferiu pro
       * Jurídico e não escreveu nada. A conversa foi pra fila certa, com o
       * motivo certo — e o cliente ficou olhando pra tela sem uma palavra,
       * sem saber que alguém já estava vindo. Do lado dele, o silêncio e
       * um sistema quebrado são a mesma coisa.
       *
       * A frase depende do que foi FEITO, não do que se imagina que o
       * modelo quis dizer: transferiu, avisa que alguém assume; encerrou,
       * despede-se. É a mesma ideia das travas — o texto passa a
       * corresponder ao mundo.
       */
      const conteudo = result.content.trim() || textoDeCortesia(usadas);
      if (!conteudo) {
        this.logger.warn(
          `IA não escreveu nada e não executou nada na conversa ${conversationId}.`,
        );
        return {
          tipo: 'indisponivel',
          motivo: 'O cliente escreveu e não houve resposta automática.',
        };
      }

      const ultimaDoCliente =
        [...context.history].reverse().find((m) => m.role === 'user')?.content ?? '';

      /*
       * Tudo que o modelo teve à disposição, num texto só.
       *
       * É contra isto que a trava de fato inventado confere o que ele
       * afirmou (ver ai-fatos). O prompt carrega as instruções da empresa,
       * a memória do cliente e os trechos da base; o histórico carrega o
       * que o próprio cliente escreveu. Fora daí, nada mais entrou — então
       * um endereço que não esteja aqui não foi lido, foi produzido.
       */
      const fontes = [
        context.systemPrompt,
        ...context.history.map((turno) => turno.content),
      ].join('\n');

      const verificacao = verificarResposta(
        conteudo,
        ultimaDoCliente,
        usadas,
        fontes,
      );

      if (verificacao.precisaHandoff || verificacao.prioridadeMinima) {
        this.logger.warn(
          `Trava da IA na conversa ${conversationId}: ${verificacao.motivo}`,
        );
      }

      if (verificacao.substituirPor) {
        this.logger.warn(
          `Resposta barrada na conversa ${conversationId} (dado sem lastro). ` +
            `A IA tinha escrito: ${conteudo}`,
        );
      }

      return {
        tipo: 'respondeu',
        resposta: {
          // A resposta barrada nunca chega ao cliente, mas o texto original
          // fica no log acima: é o que permite ao dono ver o que a IA quase
          // mandou e decidir se falta alguma coisa na base.
          content: verificacao.substituirPor ?? conteudo,
          verificacao,
        },
      };
    } catch (error) {
      this.logger.warn(
        `IA não conseguiu responder a conversa ${conversationId}: ${error instanceof Error ? error.message : error}`,
      );

      /*
       * A ferramenta já rodou. A falha veio DEPOIS disso.
       *
       * Este era o buraco que sobrou da correção anterior: eu tinha
       * tratado só o caso "o modelo devolveu texto vazio". Mas o provedor
       * também estoura por outros motivos depois de executar uma
       * ferramenta — estourou o limite de idas-e-voltas, o tempo acabou, a
       * rede caiu. Em todos eles a transferência JÁ ACONTECEU, e cair aqui
       * produzia duas coisas erradas de uma vez:
       *
       * 1. O cliente não recebia nada, embora alguém já estivesse a
       *    caminho.
       * 2. A conversa era escalada DE NOVO, agora com a nota "não houve
       *    resposta automática" — que é falsa, porque houve ação — e
       *    passando pelas regras de direcionamento outra vez. No painel
       *    apareciam dois avisos seguidos se contradizendo sobre o mesmo
       *    evento.
       *
       * Com `usadas` em mãos dá pra dizer a verdade: aconteceu isto, e é
       * isto que o cliente ouve. Sem handoff novo — a conversa já está
       * onde tem que estar.
       */
      const cortesia = textoDeCortesia(usadas);
      if (cortesia) {
        return {
          tipo: 'respondeu',
          resposta: { content: cortesia, verificacao: { precisaHandoff: false } },
        };
      }

      // O motivo sai da falha, e não de um texto fixo: cota estourada,
      // chave recusada e provedor mudo pedem providências diferentes de
      // quem administra a empresa, e a nota do painel é onde isso aparece
      // (ver ai-indisponivel).
      return {
        tipo: 'indisponivel',
        motivo: porQueAIaNaoRespondeu(error).motivo,
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
