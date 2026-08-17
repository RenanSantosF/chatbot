import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { AiCredentialsResolver } from '../ai/providers/ai-credentials.resolver';
import {
  AI_PROVIDER,
  type AiMessage,
  type AiProvider,
  type AiToolDeclaration,
} from '../ai/providers/ai-provider.interface';
import { porQueOCopilotoFalhou } from '../ai/ai-indisponivel';
import { InboxSettingsService } from '../inbox-settings/inbox-settings.service';

export interface CopilotTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Assistente do painel — o "suporte" que o operador aciona pelo ícone.
 * É outra coisa do assistente que fala com o cliente: aqui o interlocutor
 * é quem trabalha no sistema, e as ferramentas mexem em configuração da
 * empresa, não em atendimento.
 *
 * Deliberadamente sem poder destrutivo: ele lê tudo e escreve só o que dá
 * pra desfazer numa tela. Um assistente que apaga conversa ou remove
 * colaborador por interpretar mal uma frase não é conveniência, é risco.
 */
@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly credentials: AiCredentialsResolver,
    private readonly inboxSettings: InboxSettingsService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  private readonly tools: AiToolDeclaration[] = [
    {
      name: 'lerConfiguracoes',
      description:
        'Lê as configurações atuais da empresa: horário de atendimento, instruções da IA, confirmação de leitura e aviso de encerramento. Use antes de responder qualquer pergunta sobre "como está configurado".',
      parametersSchema: { type: 'object', properties: {} },
    },
    {
      name: 'ajustarAtendimento',
      description:
        'Muda as opções da caixa de entrada: confirmação de leitura (sendReadReceipts), aviso ao resolver (notifyOnResolve) e o texto desse aviso (resolveMessage). Envie só os campos que mudaram.',
      parametersSchema: {
        type: 'object',
        properties: {
          sendReadReceipts: { type: 'boolean' },
          notifyOnResolve: { type: 'boolean' },
          resolveMessage: { type: 'string' },
        },
      },
    },
    {
      name: 'ajustarIa',
      description:
        'Liga ou desliga a IA que atende clientes, muda o nome dela (aiName) ou o texto de instruções extras (customInstructions). Envie só o que mudou.',
      parametersSchema: {
        type: 'object',
        properties: {
          active: { type: 'boolean' },
          aiName: { type: 'string' },
          customInstructions: { type: 'string' },
        },
      },
    },
    {
      name: 'resumirFila',
      description:
        'Diz quantas conversas estão em cada situação e quantas estão sem responsável. Use pra perguntas do tipo "como está a fila hoje".',
      parametersSchema: { type: 'object', properties: {} },
    },
  ];

  private async execute(name: string, args: Record<string, unknown>) {
    switch (name) {
      case 'lerConfiguracoes': {
        const [inbox, ai] = await Promise.all([
          this.inboxSettings.get(),
          this.prisma.db.aiSettings.findFirst(),
        ]);
        return {
          output: {
            confirmacaoDeLeitura: inbox.sendReadReceipts,
            avisaAoResolver: inbox.notifyOnResolve,
            mensagemDeEncerramento: inbox.resolveMessage,
            iaAtiva: ai?.active ?? false,
            nomeDaIa: ai?.aiName ?? null,
            tomDaIa: ai?.tone ?? null,
            instrucoesExtras: ai?.customInstructions ?? null,
          },
        };
      }

      case 'ajustarAtendimento': {
        const patch: Record<string, unknown> = {};
        for (const key of [
          'sendReadReceipts',
          'notifyOnResolve',
          'resolveMessage',
        ]) {
          if (args[key] !== undefined) patch[key] = args[key];
        }
        if (Object.keys(patch).length === 0) {
          return { error: 'Nada foi informado pra mudar.' };
        }
        await this.inboxSettings.update(patch);
        return { output: { ok: true, alterado: Object.keys(patch) } };
      }

      case 'ajustarIa': {
        const current = await this.prisma.db.aiSettings.findFirst();
        if (!current) {
          return { error: 'Esta empresa ainda não configurou a IA.' };
        }
        const patch: Record<string, unknown> = {};
        if (typeof args.active === 'boolean') patch.active = args.active;
        if (typeof args.aiName === 'string') patch.aiName = args.aiName;
        if (typeof args.customInstructions === 'string') {
          patch.customInstructions = args.customInstructions;
        }
        if (Object.keys(patch).length === 0) {
          return { error: 'Nada foi informado pra mudar.' };
        }
        await this.prisma.db.aiSettings.update({
          where: { id: current.id },
          data: patch,
        });
        return { output: { ok: true, alterado: Object.keys(patch) } };
      }

      case 'resumirFila': {
        const [porSituacao, semDono] = await Promise.all([
          this.prisma.db.conversation.groupBy({
            by: ['status'],
            _count: { _all: true },
          }),
          this.prisma.db.conversation.count({ where: { assignedUserId: null } }),
        ]);
        return {
          output: {
            porSituacao: Object.fromEntries(
              porSituacao.map((row) => [row.status, row._count._all]),
            ),
            semResponsavel: semDono,
          },
        };
      }

      default:
        return { error: `Ferramenta desconhecida: ${name}` };
    }
  }

  async ask(history: CopilotTurn[]) {
    const resolution = await this.credentials.resolve();
    if (!resolution.credentials) {
      throw new BadRequestException(
        'Configure a chave da IA em Configurações > IA pra usar o assistente.',
      );
    }

    const messages: AiMessage[] = history.slice(-12).map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));

    /**
     * Alguma ferramenta mexeu em configuração nesta resposta?
     *
     * Muda o que dizer quando o modelo não escreve nada no fim: sem
     * ferramenta, é uma resposta perdida; COM ferramenta, a mudança JÁ
     * ACONTECEU, e devolver o balão vazio faria o operador achar que o
     * pedido dele se perdeu — e repetir a alteração.
     */
    let mexeu = false;

    try {
      const result = await this.ai.generateReply({
        systemPrompt: SYSTEM_PROMPT,
        history: messages,
        apiKey: resolution.credentials.apiKey,
        model: resolution.credentials.model,
        tools: this.tools,
        executeTool: async (name, args) => {
          if (name === 'ajustarAtendimento' || name === 'ajustarIa') mexeu = true;
          try {
            return await this.execute(name, args);
          } catch (error) {
            this.logger.warn(`Falha na ferramenta ${name}: ${String(error)}`);
            return { error: 'Não deu pra executar essa ação agora.' };
          }
        },
      });

      const conteudo = result.content.trim();
      if (conteudo) return { content: conteudo };

      return {
        content: mexeu
          ? 'Pronto, ajustei. Confira na tela de Configurações pra ver como ficou.'
          : 'Não consegui formular uma resposta pra isso. Tente perguntar de outro jeito.',
      };
    } catch (error) {
      /*
       * A falha da IA vira RESPOSTA, não exceção.
       *
       * Deixar a exceção subir era o defeito: o Nest a transformava num
       * 500 "Internal server error", o painel mostrava "o servidor falhou
       * ao responder, veja os registros da API", e o dono da empresa —
       * que não tem acesso a log nenhum — ficava sem saber que o problema
       * era a cota, ou a chave, ou uma demora do provedor.
       *
       * Aqui o assistente é a própria tela: a frase honesta no balão vale
       * mais do que um código de status que ninguém vê.
       */
      this.logger.error(
        `O assistente do painel não conseguiu responder: ${String(error)}`,
      );
      return { content: porQueOCopilotoFalhou(error), falhou: true };
    }
  }
}

const SYSTEM_PROMPT = `Você é o assistente interno de um painel de atendimento por WhatsApp.
Quem fala com você é a pessoa que OPERA o sistema — dona da empresa, admin ou atendente —, nunca um cliente final.

Como agir:
- Responda em português do Brasil, direto, sem rodeio e sem formalidade de manual.
- Antes de afirmar como algo está configurado, use lerConfiguracoes. Não chute.
- Quando pedirem uma mudança que você sabe fazer, faça com a ferramenta certa e confirme em uma frase o que mudou.
- Se o pedido for ambíguo de um jeito que mudaria o resultado (por exemplo, "muda o horário" sem dizer para quando), pergunte antes de agir.
- Se o pedido for algo que você não pode fazer, diga em que tela a pessoa resolve aquilo, com o caminho do menu.
- Nunca invente número, configuração ou nome de tela.`;
