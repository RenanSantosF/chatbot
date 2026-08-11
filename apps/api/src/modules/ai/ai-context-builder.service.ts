import { Injectable } from '@nestjs/common';
import type { AiTone } from '../../../generated/prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
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
  ) {}

  private buildSystemPrompt(params: {
    tenantName: string;
    aiName: string;
    tone: AiTone;
    customInstructions: string | null;
    instructions: { title: string; content: string }[];
    relevantChunks: RelevantChunk[];
  }): string {
    const lines = [
      `Você é ${params.aiName}, a assistente de atendimento da empresa "${params.tenantName}".`,
      `Fale em português do Brasil, em tom ${TONE_DESCRIPTION[params.tone]}.`,
      'Responda como quem manda mensagem de WhatsApp: direto, em parágrafos curtos, sem formalidade excessiva.',
      'Nunca invente informação sobre a empresa (preço, prazo, política) que não esteja nas instruções ou nos trechos de conhecimento abaixo — se não souber, diga que vai verificar com a equipe.',
      'Se o cliente pedir claramente para falar com uma pessoa, ou o assunto for sensível demais pra você decidir sozinha, diga que vai chamar alguém da equipe.',
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

  private async buildIdentityPrompt(relevantChunks: RelevantChunk[]): Promise<string> {
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
    });
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
    const relevantChunks = lastCustomerMessage
      ? await this.searchKnowledgeSafely(lastCustomerMessage.content)
      : [];

    const systemPrompt = await this.buildIdentityPrompt(relevantChunks);

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
