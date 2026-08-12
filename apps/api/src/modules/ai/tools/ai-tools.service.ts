import { Injectable, NotFoundException } from '@nestjs/common';
import type { AiToolPermission } from '../../../../generated/prisma/client';
import { TenantPrismaService } from '../../../common/prisma/tenant-prisma.service';
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
      key: 'requestHumanHandoff',
      name: 'Chamar atendente humano',
      description:
        'Sinaliza que esta conversa precisa de um humano assumir. Use quando o cliente pedir claramente por uma pessoa, ou quando o assunto for sensível/complexo demais pra você decidir sozinha.',
      parametersSchema: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Motivo curto de por que precisa de um humano' },
        },
        required: ['reason'],
      },
      execute: async (args, ctx) => {
        await this.prisma.db.message.create({
          data: {
            tenantId: this.prisma.tenantId,
            conversationId: ctx.conversationId,
            senderType: 'SYSTEM',
            content: `IA solicitou atendimento humano: ${String(args.reason ?? 'sem motivo informado')}`,
          },
        });
        const conversation = await this.prisma.db.conversation.update({
          where: { id: ctx.conversationId },
          data: { aiMode: 'HUMAN_ACTIVE', status: 'WAITING_AGENT' },
          include: conversationInclude,
        });
        this.realtime.emitToTenant(this.prisma.tenantId, 'conversation.updated', conversation);
        return { status: 'handoff_requested' };
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

  /** Ferramentas habilitadas, no formato que o AiProvider entende — chamado pelo AiEngineService a cada resposta. */
  async getEnabledDeclarations(): Promise<AiToolDeclaration[]> {
    const configured = await this.prisma.db.aiTool.findMany({ where: { enabled: true } });
    const enabledKeys = new Set(configured.map((tool) => tool.key));

    return this.registry
      .filter((tool) => enabledKeys.has(tool.key))
      .map((tool) => ({ name: tool.key, description: tool.description, parametersSchema: tool.parametersSchema }));
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
