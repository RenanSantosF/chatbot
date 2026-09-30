import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
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
import { LIMITE_DAS_INSTRUCOES_GERAIS } from '../ai/ai-context';
import { PermissionsService } from '../permissions/permissions.service';
import type { PermissionKey } from '../permissions/permissions.constants';
import type { UserRole } from '../../../generated/prisma/client';
import { extrasQueSobraram } from '../ai/ai-usage.service';
import {
  descreverSemana,
  lerExpediente,
} from '../inbox-settings/horario-comercial';

/**
 * A permissão que cada ferramenta exige — a MESMA da tela equivalente.
 *
 * O assistente não pode ser um atalho por cima das permissões: sem isto,
 * um atendente sem acesso às configurações da IA pedia "desliga a IA" ou
 * "troca as instruções" aqui, e o assistente fazia. Ferramenta que a
 * pessoa não pode usar nem é oferecida ao modelo (e é recusada de novo na
 * execução, por garantia).
 */
const PERMISSAO_DA_FERRAMENTA: Record<string, PermissionKey | null> = {
  lerConfiguracoes: null,
  lerSituacao: null,
  lerEquipe: null,
  lerAtalhos: null,
  lerTreinamentoDaIa: 'ai.manage',
  ajustarAtendimento: 'whatsapp.manage',
  ajustarIa: 'ai.manage',
  resumirFila: 'metrics.view',
};

/**
 * O que o assistente pode mudar na tela de Atendimento, com a mesma régua
 * do DTO da tela — o assistente não pode gravar o que a tela recusaria.
 */
const CAMPOS_DO_ATENDIMENTO: Record<
  string,
  | { tipo: 'booleano' }
  | { tipo: 'texto' }
  | { tipo: 'inteiro'; min: number; max: number }
  | { tipo: 'opcao'; opcoes: string[] }
> = {
  sendReadReceipts: { tipo: 'booleano' },
  notifyOnResolve: { tipo: 'booleano' },
  resolveMessage: { tipo: 'texto' },
  greetingEnabled: { tipo: 'booleano' },
  greetingMessage: { tipo: 'texto' },
  allowSendWhenResolved: { tipo: 'booleano' },
  groupByCustomer: { tipo: 'booleano' },
  groupWindowHours: { tipo: 'inteiro', min: 1, max: 720 },
  autoCloseIdle: { tipo: 'booleano' },
  autoCloseHours: { tipo: 'inteiro', min: 1, max: 23 },
  autoCloseNotify: { tipo: 'booleano' },
  autoCloseMessage: { tipo: 'texto' },
  showAgentName: { tipo: 'booleano' },
  queueVisibility: { tipo: 'opcao', opcoes: ['ALL', 'OWN_QUEUES'] },
  transcricaoDeAudio: {
    tipo: 'opcao',
    opcoes: ['DESLIGADA', 'SOB_DEMANDA', 'AUTOMATICA'],
  },
};

const TONS = ['PROFESSIONAL', 'FRIENDLY', 'CASUAL', 'OBJECTIVE', 'WARM'];
const MEMORIAS = ['NONE', 'IMPORTANT_ONLY', 'FULL'];

/** "3,2 GB" — o modelo repete o que recebe, então já vai legível. */
function tamanho(bytes: number): string {
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  const casas = i >= 3 ? 1 : 0;
  return `${valor.toFixed(casas).replace('.', ',')} ${unidades[i]}`;
}

interface Contexto {
  podeGerirIa: boolean;
  papel: UserRole;
}

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
    private readonly permissions: PermissionsService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  private readonly tools: AiToolDeclaration[] = [
    {
      name: 'lerConfiguracoes',
      description:
        'Lê como o atendimento e a IA estão configurados: horário de atendimento, saudação automática, aviso ao encerrar, confirmação de leitura, encerramento por inatividade, agrupamento de conversas, assinatura do atendente, quem vê quais conversas, transcrição de áudio, e se a IA está ligada (nome, tom, memória). Use antes de responder qualquer pergunta do tipo "como está configurado" e antes de sugerir uma mudança.',
      parametersSchema: { type: 'object', properties: {} },
    },
    {
      name: 'lerSituacao',
      description:
        'Lê a situação da conta agora: se o WhatsApp está conectado (e o último erro, se houver), quantas respostas de IA foram usadas no mês e quantas restam, e — para dono/admin — o armazenamento usado, a limpeza automática e o plano. Use quando perguntarem se algo está funcionando, ou quando reclamarem que a IA ou o WhatsApp não responde.',
      parametersSchema: { type: 'object', properties: {} },
    },
    {
      name: 'lerEquipe',
      description:
        'Lista a equipe (nome, papel, se está ativa) e os setores com quem participa de cada um.',
      parametersSchema: { type: 'object', properties: {} },
    },
    {
      name: 'lerAtalhos',
      description:
        'Lista as respostas rápidas (atalhos com barra, ex.: /bomdia) e as etiquetas de conversa.',
      parametersSchema: { type: 'object', properties: {} },
    },
    {
      name: 'lerTreinamentoDaIa',
      description:
        'Lê o que foi ensinado à IA: instruções cadastradas, documentos da base de conhecimento (e se foram lidos), dados que ela deve coletar do cliente e as regras de direcionamento (qual assunto vai para qual pessoa ou setor). Use quando perguntarem o que a IA sabe, ou reclamarem de uma resposta errada da IA.',
      parametersSchema: { type: 'object', properties: {} },
    },
    {
      name: 'ajustarAtendimento',
      description:
        'Muda opções da tela de Atendimento. Envie só os campos que mudaram. sendReadReceipts: confirmação de leitura (tique azul). notifyOnResolve/resolveMessage: aviso ao encerrar e o texto dele. greetingEnabled/greetingMessage: resposta automática no primeiro contato (só vale com a IA desligada). allowSendWhenResolved: responder conversa encerrada a reabre. groupByCustomer/groupWindowHours: juntar na mesma conversa quem volta em até N horas (1 a 720). autoCloseIdle/autoCloseHours/autoCloseNotify/autoCloseMessage: encerrar conversa parada após N horas (1 a 23), avisando ou não. showAgentName: assinar a mensagem com o nome de quem respondeu. queueVisibility: ALL (todos veem tudo) ou OWN_QUEUES (cada um vê só os próprios setores). transcricaoDeAudio: DESLIGADA, SOB_DEMANDA ou AUTOMATICA. Textos têm de 5 a 1000 caracteres.',
      parametersSchema: {
        type: 'object',
        properties: {
          sendReadReceipts: { type: 'boolean' },
          notifyOnResolve: { type: 'boolean' },
          resolveMessage: { type: 'string' },
          greetingEnabled: { type: 'boolean' },
          greetingMessage: { type: 'string' },
          allowSendWhenResolved: { type: 'boolean' },
          groupByCustomer: { type: 'boolean' },
          groupWindowHours: { type: 'integer' },
          autoCloseIdle: { type: 'boolean' },
          autoCloseHours: { type: 'integer' },
          autoCloseNotify: { type: 'boolean' },
          autoCloseMessage: { type: 'string' },
          showAgentName: { type: 'boolean' },
          queueVisibility: { type: 'string', enum: ['ALL', 'OWN_QUEUES'] },
          transcricaoDeAudio: {
            type: 'string',
            enum: ['DESLIGADA', 'SOB_DEMANDA', 'AUTOMATICA'],
          },
        },
      },
    },
    {
      name: 'ajustarIa',
      description:
        'Liga ou desliga a IA que atende clientes (active), muda o nome dela (aiName), o tom (tone: PROFESSIONAL, FRIENDLY, CASUAL, OBJECTIVE ou WARM), o quanto ela guarda sobre cada cliente (memoryMode: NONE, IMPORTANT_ONLY ou FULL) ou o texto de instruções gerais (customInstructions — substitui o texto inteiro, então leia antes e preserve o que já existe). Envie só o que mudou.',
      parametersSchema: {
        type: 'object',
        properties: {
          active: { type: 'boolean' },
          aiName: { type: 'string' },
          tone: { type: 'string', enum: TONS },
          memoryMode: { type: 'string', enum: MEMORIAS },
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

  private async execute(
    name: string,
    args: Record<string, unknown>,
    { podeGerirIa, papel }: Contexto,
  ) {
    switch (name) {
      case 'lerConfiguracoes': {
        const [inbox, ai, instrucoes] = await Promise.all([
          this.inboxSettings.get(),
          this.prisma.db.aiSettings.findFirst(),
          this.prisma.db.aiInstruction.count({ where: { active: true } }),
        ]);
        const semana = descreverSemana(lerExpediente(inbox.businessHours));
        return {
          output: {
            horarioDeAtendimento:
              semana.length > 0
                ? semana
                : 'Não configurado — a empresa é tratada como aberta o tempo todo.',
            confirmacaoDeLeitura: inbox.sendReadReceipts,
            saudacaoAutomatica: {
              ligada: inbox.greetingEnabled,
              texto: inbox.greetingMessage,
              observacao: ai?.active
                ? 'Com a IA ligada, a saudação automática não é enviada — quem responde é a IA.'
                : undefined,
            },
            avisoAoEncerrar: {
              ligado: inbox.notifyOnResolve,
              texto: inbox.resolveMessage,
            },
            responderConversaEncerradaReabre: inbox.allowSendWhenResolved,
            juntarConversasDoMesmoCliente: inbox.groupByCustomer
              ? `sim, se o cliente voltar em até ${inbox.groupWindowHours} h`
              : 'não — cada assunto vira uma conversa nova',
            encerrarConversaParada: inbox.autoCloseIdle
              ? {
                  depoisDeHoras: inbox.autoCloseHours,
                  avisaOCliente: inbox.autoCloseNotify,
                }
              : 'desligado',
            assinaComNomeDoAtendente: inbox.showAgentName,
            quemVeAsConversas:
              inbox.queueVisibility === 'OWN_QUEUES'
                ? 'cada atendente vê só os setores de que participa (dono e admin veem tudo)'
                : 'todo mundo vê todas as conversas',
            transcricaoDeAudio: inbox.transcricaoDeAudio,
            ia: {
              ligada: ai?.active ?? false,
              nome: ai?.aiName ?? null,
              tom: ai?.tone ?? null,
              memoriaSobreClientes: ai?.memoryMode ?? null,
              instrucoesEnsinadasAtivas: instrucoes,
              // As instruções da IA são da tela que o papel dela não abre.
              instrucoesGerais: podeGerirIa
                ? (ai?.customInstructions ?? null)
                : undefined,
            },
          },
        };
      }

      case 'lerSituacao':
        return { output: await this.situacao(papel) };

      case 'lerEquipe': {
        const [pessoas, setores] = await Promise.all([
          this.prisma.db.user.findMany({
            select: { name: true, role: true, status: true },
            orderBy: { name: 'asc' },
          }),
          this.prisma.db.queue.findMany({
            select: {
              name: true,
              description: true,
              members: { select: { user: { select: { name: true } } } },
            },
            orderBy: { name: 'asc' },
          }),
        ]);
        return {
          output: {
            equipe: pessoas.map((p) => ({
              nome: p.name,
              papel: p.role,
              situacao: p.status,
            })),
            setores: setores.map((s) => ({
              nome: s.name,
              descricao: s.description,
              participantes: s.members.map((m) => m.user.name),
            })),
          },
        };
      }

      case 'lerAtalhos': {
        const [atalhos, etiquetas] = await Promise.all([
          this.prisma.db.quickReply.findMany({
            select: { shortcut: true, title: true, content: true },
            orderBy: { usageCount: 'desc' },
            take: 40,
          }),
          this.prisma.db.tag.findMany({
            select: { name: true },
            orderBy: { name: 'asc' },
          }),
        ]);
        return {
          output: {
            respostasRapidas: atalhos.map((a) => ({
              atalho: `/${a.shortcut}`,
              titulo: a.title,
              texto: a.content.slice(0, 160),
            })),
            etiquetas: etiquetas.map((e) => e.name),
          },
        };
      }

      case 'lerTreinamentoDaIa': {
        const [instrucoes, documentos, campos, regras] = await Promise.all([
          this.prisma.db.aiInstruction.findMany({
            select: { title: true, content: true, active: true },
            orderBy: { priority: 'desc' },
            take: 30,
          }),
          this.prisma.db.knowledgeDocument.findMany({
            select: { title: true, status: true, errorMessage: true },
            orderBy: { createdAt: 'desc' },
            take: 30,
          }),
          this.prisma.db.collectionField.findMany({
            select: { label: true, required: true, active: true },
            orderBy: { order: 'asc' },
          }),
          this.prisma.db.routingRule.findMany({
            select: {
              name: true,
              subject: true,
              active: true,
              minPriority: true,
              targetUser: { select: { name: true } },
              targetQueue: { select: { name: true } },
            },
            orderBy: { priorityOrder: 'asc' },
          }),
        ]);
        return {
          output: {
            instrucoes: instrucoes.map((i) => ({
              titulo: i.title,
              texto: i.content.slice(0, 300),
              ativa: i.active,
            })),
            documentos: documentos.map((d) => ({
              titulo: d.title,
              situacao:
                d.status === 'READY'
                  ? 'lido'
                  : d.status === 'PROCESSING'
                    ? 'lendo'
                    : `falhou${d.errorMessage ? `: ${d.errorMessage}` : ''}`,
            })),
            dadosAColetar: campos.map((c) => ({
              campo: c.label,
              obrigatorio: c.required,
              ativo: c.active,
            })),
            regrasDeDirecionamento: regras.map((r) => ({
              nome: r.name,
              quandoUsar: r.subject,
              ativa: r.active,
              soUrgentes: r.minPriority === 'URGENT',
              destino:
                r.targetUser?.name ??
                (r.targetQueue ? `setor ${r.targetQueue.name}` : 'sem destino'),
            })),
          },
        };
      }

      case 'ajustarAtendimento': {
        const patch: Record<string, unknown> = {};
        for (const [campo, regra] of Object.entries(CAMPOS_DO_ATENDIMENTO)) {
          const valor = args[campo];
          if (valor === undefined) continue;
          const valido =
            regra.tipo === 'booleano'
              ? typeof valor === 'boolean'
              : regra.tipo === 'texto'
                ? typeof valor === 'string' &&
                  valor.trim().length >= 5 &&
                  valor.length <= 1000
                : regra.tipo === 'inteiro'
                  ? Number.isInteger(valor) &&
                    (valor as number) >= regra.min &&
                    (valor as number) <= regra.max
                  : regra.opcoes.includes(valor as string);
          if (!valido) return { error: `Valor inválido para ${campo}.` };
          patch[campo] = typeof valor === 'string' ? valor.trim() : valor;
        }
        if (Object.keys(patch).length === 0) {
          return { error: 'Nada foi informado pra mudar.' };
        }
        if (patch.greetingEnabled === true) {
          const ai = await this.prisma.db.aiSettings.findFirst();
          if (ai?.active) {
            return {
              error:
                'A saudação automática não funciona com a IA ligada (quem responde é a IA). Desligue a IA antes, se for isso mesmo que a pessoa quer.',
            };
          }
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
        if (typeof args.tone === 'string' && TONS.includes(args.tone)) {
          patch.tone = args.tone;
        }
        if (
          typeof args.memoryMode === 'string' &&
          MEMORIAS.includes(args.memoryMode)
        ) {
          patch.memoryMode = args.memoryMode;
        }
        if (typeof args.customInstructions === 'string') {
          // O mesmo teto da tela: estas instruções vão em toda resposta.
          if (args.customInstructions.length > LIMITE_DAS_INSTRUCOES_GERAIS) {
            return {
              error: `As instruções gerais podem ter no máximo ${LIMITE_DAS_INSTRUCOES_GERAIS} caracteres.`,
            };
          }
          patch.customInstructions = args.customInstructions;
        }
        if (Object.keys(patch).length === 0) {
          return { error: 'Nada foi informado pra mudar.' };
        }
        await this.prisma.db.aiSettings.update({
          where: { id: current.id },
          data: patch,
        });
        // Ligar a IA desliga a saudação automática, como a tela faz: as
        // duas juntas nunca disparam, e deixar "ligada" seria mentir.
        if (patch.active === true) {
          const inbox = await this.inboxSettings.get();
          if (inbox.greetingEnabled) {
            await this.inboxSettings.update({ greetingEnabled: false });
            return {
              output: {
                ok: true,
                alterado: Object.keys(patch),
                observacao:
                  'A saudação automática foi desligada, porque com a IA ligada quem responde o primeiro contato é a IA.',
              },
            };
          }
        }
        return { output: { ok: true, alterado: Object.keys(patch) } };
      }

      case 'resumirFila': {
        const [porSituacao, semDono] = await Promise.all([
          this.prisma.db.conversation.groupBy({
            by: ['status'],
            _count: { _all: true },
          }),
          this.prisma.db.conversation.count({
            where: { assignedUserId: null },
          }),
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

  /**
   * WhatsApp, cota da IA e — pra quem cuida da conta — espaço e plano.
   *
   * É o que responde "por que a IA não está respondendo?": na prática é
   * quase sempre uma destas três coisas (desconectado, cota do mês no fim,
   * IA desligada), e o assistente precisa enxergá-las pra não chutar.
   */
  private async situacao(papel: UserRole) {
    const [tenant, evolution, meta, conta, retencao] = await Promise.all([
      this.prisma.db.tenant.findUnique({
        where: { id: this.prisma.tenantId },
        select: { canal: true },
      }),
      this.prisma.db.evolutionSettings.findFirst(),
      this.prisma.db.whatsAppSettings.findFirst({
        select: { displayPhoneNumber: true },
      }),
      this.prisma.db.billingAccount.findFirst(),
      this.prisma.db.retentionSettings.findFirst(),
    ]);

    const whatsapp =
      tenant?.canal === 'EVOLUTION'
        ? evolution
          ? {
              conectado: evolution.estado === 'CONECTADO',
              estado: evolution.estado,
              numero: evolution.connectedPhone,
              ultimoErro: evolution.lastError,
            }
          : { conectado: false, estado: 'nunca conectado' }
        : meta
          ? { conectado: true, numero: meta.displayPhoneNumber }
          : { conectado: false, estado: 'nunca conectado' };

    // Mesma virada de mês do AiUsageService, só lendo: um mês novo ainda
    // não tocado conta zero usadas e só o que sobrou dos pacotes.
    const agora = new Date();
    const inicio = conta?.aiUsagePeriodStart;
    const mesmoMes =
      !!inicio &&
      inicio.getUTCFullYear() === agora.getUTCFullYear() &&
      inicio.getUTCMonth() === agora.getUTCMonth();
    const plano = conta?.aiMonthlyMessageLimit ?? 5000;
    const extras = !conta
      ? 0
      : mesmoMes
        ? conta.aiExtraMessagesThisPeriod
        : extrasQueSobraram(conta);
    const usadas = mesmoMes ? (conta?.aiRepliesUsed ?? 0) : 0;
    const limite = plano + extras;

    const cuidaDaConta = papel === 'OWNER' || papel === 'ADMIN';
    const usado = Number(conta?.usedBytes ?? 0);
    const cota = Number(conta?.quotaBytes ?? 21474836480);

    return {
      whatsapp,
      respostasDeIaNoMes: {
        usadas,
        limite,
        restantes: Math.max(0, limite - usadas),
        doPlano: plano,
        compradas: extras,
        acabou: usadas >= limite,
      },
      armazenamento: cuidaDaConta
        ? {
            usado: tamanho(usado),
            cota: tamanho(cota),
            porcento: Math.round((usado / Math.max(cota, 1)) * 100),
            limpezaAutomaticaQuandoEncher: retencao?.autoPurgeOnFull ?? false,
            guardarMensagensPorDias: retencao?.keepMessagesDays ?? 'sempre',
          }
        : undefined,
      plano: cuidaDaConta
        ? {
            nome: conta?.planLabel ?? 'Grátis',
            assinaturaAtiva: Boolean(conta?.stripeSubscriptionId),
          }
        : undefined,
    };
  }

  async ask(history: CopilotTurn[], role: UserRole) {
    const resolution = await this.credentials.resolve();
    if (!resolution.credentials) {
      throw new BadRequestException(
        'A IA da plataforma está temporariamente indisponível — não dá pra usar o assistente agora.',
      );
    }

    const permitidas = new Set<string>();
    for (const tool of this.tools) {
      const exigida = PERMISSAO_DA_FERRAMENTA[tool.name];
      if (!exigida || (await this.permissions.can(role, exigida))) {
        permitidas.add(tool.name);
      }
    }
    const podeGerirIa = permitidas.has('ajustarIa');

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
        tools: this.tools.filter((tool) => permitidas.has(tool.name)),
        executeTool: async (name, args) => {
          if (!permitidas.has(name)) {
            return { error: 'Seu perfil não tem permissão para esta ação.' };
          }
          if (name === 'ajustarAtendimento' || name === 'ajustarIa')
            mexeu = true;
          try {
            return await this.execute(name, args, {
              podeGerirIa,
              papel: role,
            });
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

const SYSTEM_PROMPT = `Você é o assistente interno de um painel de atendimento por WhatsApp com IA.
Quem fala com você é a pessoa que OPERA o sistema — dona da empresa, admin ou atendente —, nunca um cliente final.

Como agir:
- Português do Brasil, direto, curto, sem formalidade de manual. Listas curtas quando ajudarem.
- Antes de afirmar como algo está configurado ou se algo está funcionando, consulte a ferramenta certa. Não chute, não invente número, configuração ou nome de tela.
- Fale a língua da tela, nunca o nome interno do campo: "confirmação de leitura", não "sendReadReceipts".
- Quando pedirem uma mudança que você sabe fazer, faça e confirme em uma frase o que mudou.
- Se o pedido for ambíguo de um jeito que mudaria o resultado, pergunte antes de agir.
- Se for algo que você não faz, diga em que tela resolver, com o caminho do menu.
- Se uma ferramenta não estiver disponível pra você, é porque o perfil da pessoa não tem acesso: diga que quem resolve é o dono ou um admin.

O que você faz sozinho:
- Explicar como está tudo configurado (atendimento, horário, IA, equipe, setores, atalhos, etiquetas, o que a IA aprendeu).
- Dizer a situação da conta: WhatsApp conectado ou não, respostas de IA usadas no mês, espaço usado e plano.
- Ligar/desligar e ajustar: confirmação de leitura, aviso e texto de encerramento, saudação automática, encerramento de conversa parada, juntar conversas do mesmo cliente, assinatura com o nome do atendente, quem vê quais conversas, transcrição de áudio.
- Ligar/desligar a IA, mudar o nome, o tom, a memória sobre clientes e as instruções gerais.
- Resumir a fila.

O que você não faz (e onde a pessoa resolve), pelo menu Configurações:
- WhatsApp: conectar, reconectar ou trocar o número.
- Atendimento: horário de atendimento (dias e faixas, com almoço).
- IA: ensinar instruções novas uma a uma.
- Conhecimento: enviar documentos (PDF, planilhas, textos) pra IA consultar.
- Dados a coletar: o que a IA pergunta ao cliente (nome, CPF, e-mail...).
- Direcionamento: qual assunto vai pra qual pessoa ou setor.
- Setores, Equipe (convidar e remover pessoas), Permissões (o que cada papel pode fazer).
- Armazenamento: prazo de guarda e limpeza automática quando encher.
- Conta: plano, pagamento e compra de respostas extras de IA.
Você nunca apaga conversa, cliente, pessoa nem a conta.

Quando a pessoa reclamar, investigue antes e proponha a correção concreta:
- "A IA não responde": veja lerSituacao e lerConfiguracoes — WhatsApp desconectado? IA desligada? Respostas do mês acabaram (aí: comprar respostas extras em Configurações › Conta)? Diga qual é, e ofereça ligar o que você pode ligar.
- "A IA respondeu errado / inventou / não sabia": veja lerTreinamentoDaIa. Sugira ensinar uma instrução com a resposta certa (Configurações › IA) ou enviar o documento com a informação (Conhecimento). Se o problema for o jeito de falar, ofereça mudar o tom.
- "Mandou pro setor/pessoa errada": mostre as regras de direcionamento e sugira ajustar a descrição do assunto em Direcionamento.
- "O cliente vê que eu li e não respondi": ofereça desligar a confirmação de leitura.
- "O cliente não sabe que encerrou" ou "fica esperando": ofereça ligar o aviso ao encerrar.
- "Tem muita conversa parada na fila": ofereça ligar o encerramento de conversa parada, com aviso ao cliente.
- "O atendente vê conversa de outro setor": ofereça que cada um veja só os próprios setores.
- "Responde fora do horário" ou "não responde à noite": mostre o horário configurado e aponte Configurações › Atendimento.
- "Espaço cheio": mostre quanto está usado e ofereça o caminho de Armazenamento (prazo de guarda ou limpeza automática, que apaga das mensagens mais antigas pras mais novas).
Se não achar a causa, diga o que conferiu e sugira falar com o suporte.

Se perguntarem "o que você sabe fazer", responda com um resumo curto das listas acima e 2 ou 3 exemplos de pedido.`;
