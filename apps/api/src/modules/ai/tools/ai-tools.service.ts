import { Injectable, NotFoundException } from '@nestjs/common';
import type { AiToolPermission, Prisma } from '../../../../generated/prisma/client';
import { TenantPrismaService } from '../../../common/prisma/tenant-prisma.service';
import { QueuesService } from '../../queues/queues.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import type { AiToolCallResult, AiToolDeclaration } from '../providers/ai-provider.interface';

interface ToolExecutionContext {
  conversationId: string;
}

interface BuiltInTool {
  key: string;
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<unknown>;
}

export interface ConfiguredTool {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  permission: AiToolPermission;
}

const conversationInclude = {
  customer: true,
  assignedUser: { select: { id: true, name: true, email: true, avatar: true } },
  queue: true,
} as const;

/**
 * Catálogo de ferramentas nativas + execução com permissão. O catálogo em
 * si (quais ferramentas existem, o que cada uma faz) é código — só o
 * enabled/permission de cada uma é configurável por tenant (ver AiTool no
 * schema). Ferramentas customizadas via HTTP (Fase 5b) vão entrar aqui como
 * um segundo tipo de entrada no mesmo catálogo.
 */
@Injectable()
export class AiToolsService {
  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly queues: QueuesService,
  ) {}

  private readonly registry: BuiltInTool[] = [
    {
      key: 'searchCustomer',
      name: 'Buscar cliente',
      description:
        'Busca clientes já cadastrados pelo telefone ou nome. Use quando precisar confirmar ou encontrar dados de um cliente existente.',
      parametersSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Telefone ou nome (ou parte do nome) do cliente' },
        },
        required: ['query'],
      },
      execute: async (args) => {
        const query = String(args.query ?? '').trim();
        if (!query) {
          return [];
        }
        const customers = await this.prisma.db.customer.findMany({
          where: { OR: [{ phone: { contains: query } }, { name: { contains: query, mode: 'insensitive' } }] },
          take: 5,
        });
        return customers.map((customer) => ({ id: customer.id, name: customer.name, phone: customer.phone }));
      },
    },
    {
      key: 'createTask',
      name: 'Criar tarefa',
      description:
        'Cria uma tarefa de acompanhamento pra equipe humana resolver depois. Use quando identificar algo que precisa de ação humana, mas que não impede o atendimento de continuar agora.',
      parametersSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título curto da tarefa' },
          description: { type: 'string', description: 'Detalhes adicionais, se houver' },
        },
        required: ['title'],
      },
      execute: async (args, ctx) => {
        const task = await this.prisma.db.task.create({
          data: {
            tenantId: this.prisma.tenantId,
            conversationId: ctx.conversationId,
            title: String(args.title ?? '').slice(0, 200),
            description: args.description ? String(args.description) : null,
            createdByAi: true,
          },
        });
        return { taskId: task.id, status: 'created' };
      },
    },
    {
      key: 'transferToQueue',
      name: 'Transferir atendimento',
      description:
        'Transfere a conversa pra um humano assumir. Se souber qual área é mais apropriada, informe queueKey; se não tiver certeza ou não houver fila específica, deixe queueKey vazio. Use quando o cliente pedir claramente por uma pessoa, ou o assunto for sensível/complexo demais pra você decidir sozinha.',
      parametersSchema: {
        type: 'object',
        properties: {
          queueKey: { type: 'string', description: 'Chave da fila mais apropriada pra este assunto, se houver uma' },
          reason: { type: 'string', description: 'Motivo curto da transferência' },
          summary: {
            type: 'string',
            description: 'Resumo do que o cliente precisa, pra quem for atender não perder contexto',
          },
          collectedData: {
            type: 'object',
            description:
              'Dados relevantes já coletados do cliente durante a conversa, como pares chave-valor (ex: {"idade": "58", "cidade": "São Paulo"})',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['reason', 'summary'],
      },
      execute: async (args, ctx) => {
        const queueKeyArg = args.queueKey ? String(args.queueKey).trim() : null;
        const queue = queueKeyArg ? await this.queues.findByKey(queueKeyArg) : null;
        const assignedUserId = queue ? await this.queues.pickNextMember(queue.id) : null;

        const reason = String(args.reason ?? 'não informado');
        const summary = String(args.summary ?? '');
        const collectedData =
          args.collectedData && typeof args.collectedData === 'object'
            ? (args.collectedData as Prisma.InputJsonValue)
            : undefined;

        await this.prisma.db.message.create({
          data: {
            tenantId: this.prisma.tenantId,
            conversationId: ctx.conversationId,
            senderType: 'SYSTEM',
            content: queue
              ? `IA transferiu para a fila "${queue.name}": ${reason}`
              : `IA solicitou atendimento humano: ${reason}`,
          },
        });

        const conversation = await this.prisma.db.conversation.update({
          where: { id: ctx.conversationId },
          data: {
            aiMode: 'HUMAN_ACTIVE',
            status: 'WAITING_AGENT',
            queueId: queue?.id,
            assignedUserId: assignedUserId ?? undefined,
            escalationReason: reason,
            escalationSummary: summary,
            collectedData,
          },
          include: conversationInclude,
        });

        this.realtime.emitToTenant(this.prisma.tenantId, 'conversation.updated', conversation);

        return { status: 'transferred', queue: queue?.name ?? null, assigned: Boolean(assignedUserId) };
      },
    },
  ];

  private findInRegistry(key: string): BuiltInTool {
    const tool = this.registry.find((item) => item.key === key);
    if (!tool) {
      throw new NotFoundException('Ferramenta não encontrada.');
    }
    return tool;
  }

  /** Configuração completa (catálogo + estado por tenant) — usado pela tela de Configurações > IA > Ferramentas. */
  async listConfigured(): Promise<ConfiguredTool[]> {
    const configured = await this.prisma.db.aiTool.findMany();
    const byKey = new Map(configured.map((tool) => [tool.key, tool]));

    return this.registry.map((tool) => ({
      key: tool.key,
      name: tool.name,
      description: tool.description,
      enabled: byKey.get(tool.key)?.enabled ?? false,
      permission: byKey.get(tool.key)?.permission ?? 'REQUIRES_APPROVAL',
    }));
  }

  async setConfig(key: string, data: { enabled?: boolean; permission?: AiToolPermission }): Promise<ConfiguredTool> {
    const tool = this.findInRegistry(key);
    const tenantId = this.prisma.tenantId;

    const updated = await this.prisma.db.aiTool.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, ...data },
      update: data,
    });

    return {
      key: tool.key,
      name: tool.name,
      description: tool.description,
      enabled: updated.enabled,
      permission: updated.permission,
    };
  }

  /**
   * Ferramentas habilitadas, no formato que o AiProvider entende — chamado
   * pelo AiEngineService a cada resposta. transferToQueue ganha um enum
   * dinâmico com as filas reais do tenant, pra IA nunca inventar uma
   * fila que não existe.
   */
  async getEnabledDeclarations(): Promise<AiToolDeclaration[]> {
    const configured = await this.prisma.db.aiTool.findMany({ where: { enabled: true } });
    const enabledKeys = new Set(configured.map((tool) => tool.key));
    const enabledTools = this.registry.filter((tool) => enabledKeys.has(tool.key));

    const queues = enabledKeys.has('transferToQueue') ? await this.prisma.db.queue.findMany() : [];

    return enabledTools.map((tool) => {
      if (tool.key !== 'transferToQueue' || queues.length === 0) {
        return { name: tool.key, description: tool.description, parametersSchema: tool.parametersSchema };
      }

      const schema = JSON.parse(JSON.stringify(tool.parametersSchema)) as {
        properties: { queueKey: { description: string; enum?: string[] } };
      };
      schema.properties.queueKey.enum = queues.map((queue) => queue.key);
      schema.properties.queueKey.description = `Fila mais apropriada: ${queues
        .map((queue) => `${queue.key} (${queue.name})`)
        .join(', ')}. Deixe vazio se nenhuma se aplicar.`;

      return { name: tool.key, description: tool.description, parametersSchema: schema };
    });
  }

  /**
   * Executa respeitando a permissão configurada. A IA decide QUAL
   * ferramenta usar; isto aqui decide SE ela tem permissão — a IA nunca
   * pula essa checagem.
   */
  async execute(key: string, args: Record<string, unknown>, conversationId: string): Promise<AiToolCallResult> {
    const tool = this.registry.find((item) => item.key === key);
    if (!tool) {
      return { error: `Ferramenta "${key}" desconhecida.` };
    }

    const config = await this.prisma.db.aiTool.findFirst({ where: { key } });
    const permission = config?.permission ?? 'REQUIRES_APPROVAL';

    if (permission === 'DENY') {
      return { error: 'Esta ferramenta não está disponível.' };
    }

    if (permission === 'REQUIRES_APPROVAL') {
      // Fase 5a: nunca executa sozinha quando exige aprovação — cria uma
      // tarefa pra um humano revisar e avisa a IA que precisa aguardar, em
      // vez de aprovar e retomar a ação automaticamente depois (esse
      // fluxo de "aprovar e retomar" fica pra uma fase futura).
      await this.prisma.db.task.create({
        data: {
          tenantId: this.prisma.tenantId,
          conversationId,
          title: `Aprovar: ${tool.name}`,
          description: `A IA quis usar "${tool.name}" com os parâmetros: ${JSON.stringify(args)}.`,
          createdByAi: true,
        },
      });
      return {
        error: 'Esta ação exige aprovação de um humano antes de acontecer. Um responsável da equipe vai revisar.',
      };
    }

    try {
      const output = await tool.execute(args, { conversationId });
      return { output };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Falha ao executar a ferramenta.' };
    }
  }
}
