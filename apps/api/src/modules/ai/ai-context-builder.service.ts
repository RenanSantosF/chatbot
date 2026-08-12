import { Injectable } from '@nestjs/common';
import type { AiTone } from '../../../generated/prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { CollectionService } from '../collection/collection.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import type { AiMessage } from './providers/ai-provider.interface';

const HISTORY_LIMIT = 20;

const TONE_DESCRIPTION: Record<AiTone, string> = {
  PROFESSIONAL: 'profissional e direto, sem gírias',
  FRIENDLY: 'amigável e caloroso, mas sem exageros',
  CASUAL: 'informal, como uma conversa comum de WhatsApp',
  OBJECTIVE: 'muito objetivo, frases curtas, sem enrolação',
  WARM: 'acolhedor, transmitindo cuidado com quem está do outro lado',
};

export interface AiConversationContext {
  systemPrompt: string;
  history: AiMessage[];
}

interface RelevantChunk {
  content: string;
  documentTitle: string;
}

/**
 * Monta o que a IA "sabe" antes de responder: quem ela é, como a empresa
 * quer que ela se comporte, as instruções que o dono ensinou, os trechos
 * relevantes da base de conhecimento (RAG) pra pergunta atual, e o
 * histórico recente da conversa. Isso é o que impede a IA de inventar
 * política da empresa — se não está no prompt, ela não sabe.
 */
@Injectable()
export class AiContextBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly collection: CollectionService,
  ) {}

  private buildSystemPrompt(params: {
    tenantName: string;
    aiName: string;
    tone: AiTone;
    customInstructions: string | null;
    instructions: { title: string; content: string }[];
    relevantChunks: RelevantChunk[];
    customerMemory: Record<string, string>;
    pendingFields: string[];
  }): string {
    const lines = [
      `Você é ${params.aiName}, a assistente de atendimento da empresa "${params.tenantName}".`,
      `Fale em português do Brasil, em tom ${TONE_DESCRIPTION[params.tone]}.`,
      'Responda como quem manda mensagem de WhatsApp: direto, em parágrafos curtos, sem formalidade excessiva.',
      'Nunca invente informação sobre a empresa (preço, prazo, política) que não esteja nas instruções ou nos trechos de conhecimento abaixo.',
      // Regra dura: a IA não tem como voltar sozinha numa conversa depois.
      // Sem isso ela promete "já te retorno", ninguém é avisado, e o
      // cliente fica esperando um retorno que nunca vem.
      'NUNCA prometa retornar depois, "verificar e dar um retorno", "já te aviso" ou qualquer coisa parecida. Você não consegue reabrir a conversa por conta própria: quem responde depois é uma pessoa da equipe, e ela só fica sabendo se você acionar a ferramenta de transferência.',
      'Quando não souber a resposta, quando o cliente pedir uma pessoa, ou quando o assunto for sensível demais: acione a ferramenta de transferir atendimento NA MESMA resposta e diga ao cliente que alguém da equipe vai continuar dali. Sem a ferramenta, ninguém é avisado.',
      'Se a ferramenta de transferência não estiver disponível, seja honesta: diga que não tem essa informação e oriente o cliente a falar com a equipe pelos canais da empresa — não invente um retorno.',
    ];

    if (params.customInstructions) {
      lines.push('', 'Instruções gerais de comportamento:', params.customInstructions);
    }

    if (params.instructions.length > 0) {
      lines.push('', 'Instruções específicas que a empresa te ensinou:');
      for (const instruction of params.instructions) {
        lines.push(`- ${instruction.title}: ${instruction.content}`);
      }
    }

    if (params.pendingFields.length > 0) {
      lines.push(
        '',
        `Dados que a empresa exige coletar e que ainda faltam: ${params.pendingFields.join(', ')}.`,
        'Peça esses dados naturalmente ao longo da conversa (um ou dois por vez, nunca todos de uma vez) e registre cada um com a ferramenta collectCustomerData assim que o cliente informar. Sem eles você não consegue transferir o atendimento.',
      );
    }

    const memoryEntries = Object.entries(params.customerMemory);
    if (memoryEntries.length > 0) {
      lines.push(
        '',
        'O que você já sabe deste cliente de conversas anteriores (use com naturalidade, sem anunciar que "consultou um registro"):',
      );
      for (const [key, value] of memoryEntries) {
        lines.push(`- ${key}: ${value}`);
      }
    }

    if (params.relevantChunks.length > 0) {
      lines.push(
        '',
        'Trechos da base de conhecimento relevantes pra pergunta atual (use só o que realmente responder o cliente, ignore o resto):',
      );
      for (const chunk of params.relevantChunks) {
        lines.push(`[${chunk.documentTitle}]\n${chunk.content}`);
      }
    }

    return lines.join('\n');
  }

  private async buildIdentityPrompt(
    relevantChunks: RelevantChunk[],
    customerMemory: Record<string, string> = {},
    pendingFields: string[] = [],
  ): Promise<string> {
    const tenantId = this.tenantPrisma.tenantId;

    const [tenant, settings, instructions] = await Promise.all([
      this.prisma.client.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      this.tenantPrisma.db.aiSettings.findFirst(),
      this.tenantPrisma.db.aiInstruction.findMany({
        where: { active: true },
        orderBy: { priority: 'desc' },
      }),
    ]);

    return this.buildSystemPrompt({
      tenantName: tenant.name,
      aiName: settings?.aiName ?? 'Assistente',
      tone: settings?.tone ?? 'PROFESSIONAL',
      customInstructions: settings?.customInstructions ?? null,
      instructions,
      relevantChunks,
      // Com a memória desligada, o que já estava guardado também para de ser
      // usado — não é só a gravação nova que fica bloqueada.
      customerMemory: settings?.memoryMode === 'NONE' ? {} : customerMemory,
      pendingFields,
    });
  }

  private async loadCustomerMemory(
    conversationId: string,
  ): Promise<Record<string, string>> {
    const conversation = await this.tenantPrisma.db.conversation.findFirst({
      where: { id: conversationId },
      select: { customer: { select: { metadata: true } } },
    });

    const metadata = conversation?.customer.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (value === null || typeof value === 'object') continue;
      result[key] = String(value);
    }
    return result;
  }

  /** Nunca deixa uma falha na busca de conhecimento derrubar a resposta da IA. */
  private async searchKnowledgeSafely(query: string): Promise<RelevantChunk[]> {
    try {
      return await this.knowledge.searchRelevantChunks(query);
    } catch {
      return [];
    }
  }

  async build(conversationId: string): Promise<AiConversationContext> {
    const messages = await this.tenantPrisma.db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
    });

    const ordered = messages.reverse();
    const lastCustomerMessage = [...ordered].reverse().find((message) => message.senderType === 'CUSTOMER');
    const [relevantChunks, customerMemory, pendingFields] = await Promise.all([
      lastCustomerMessage ? this.searchKnowledgeSafely(lastCustomerMessage.content) : Promise.resolve([]),
      this.loadCustomerMemory(conversationId),
      this.collection.missingRequired(conversationId),
    ]);

    const systemPrompt = await this.buildIdentityPrompt(relevantChunks, customerMemory, pendingFields);

    const history: AiMessage[] = ordered
      .filter((message) => message.senderType !== 'SYSTEM')
      .map((message) => ({
        role: message.senderType === 'CUSTOMER' ? 'user' : 'assistant',
        content: message.content,
      }));

    return { systemPrompt, history };
  }

  /** Usado pelo simulador (/ai/simulate) — sem conversa real, só a mensagem digitada na hora. */
  async buildStandalone(message: string): Promise<AiConversationContext> {
    const relevantChunks = await this.searchKnowledgeSafely(message);
    const systemPrompt = await this.buildIdentityPrompt(relevantChunks);
    return { systemPrompt, history: [{ role: 'user', content: message }] };
  }
}
