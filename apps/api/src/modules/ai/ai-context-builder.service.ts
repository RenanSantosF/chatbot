import { Injectable } from '@nestjs/common';
import type { AiTone } from '../../../generated/prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { CollectionService } from '../collection/collection.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import {
  LIMITE_DA_MEMORIA,
  LIMITE_DO_HISTORICO,
  LIMITE_POR_MENSAGEM,
  agoraNoFuso,
  cabemNoOrcamento,
  descreverMensagem,
  encurtar,
  juntarTurnosSeguidos,
  marcarSaltoDeTempo,
  mereceBuscaNaBase,
} from './ai-context';
import type { AiMessage } from './providers/ai-provider.interface';

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
 *
 * Tudo aqui é pago por resposta. Cada bloco só entra quando tem chance de
 * ser usado, e os limites de tamanho estão em `ai-context.ts`, com o
 * porquê de cada número.
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
    agora: string;
    customerName: string | null;
    customInstructions: string | null;
    instructions: { title: string; content: string }[];
    relevantChunks: RelevantChunk[];
    customerMemory: Record<string, string>;
    pendingFields: string[];
  }): string {
    const lines = [
      `Você é ${params.aiName}, a assistente de atendimento da empresa "${params.tenantName}".`,
      // A IA não tem relógio próprio. Sem esta linha ela falava em "hoje" e
      // "amanhã" sem saber que dia era, e marcava coisa pra domingo numa
      // empresa que atende de segunda a sexta.
      `Agora é ${params.agora} (fuso da empresa). Use isto pra qualquer conta de data ou horário.`,
      `Fale em português do Brasil, em tom ${TONE_DESCRIPTION[params.tone]}.`,
      'Escreva como quem manda mensagem de WhatsApp: direto, parágrafos curtos, no máximo umas quatro linhas. Se a resposta for longa, mande o essencial e ofereça o resto.',
      'Nunca invente informação sobre a empresa (preço, prazo, política) que não esteja nas instruções ou nos trechos de conhecimento abaixo.',
      // Regra dura: a IA não tem como voltar sozinha numa conversa depois.
      // Sem isso ela promete "já te retorno", ninguém é avisado, e o
      // cliente fica esperando um retorno que nunca vem.
      'NUNCA prometa retornar depois ("vou verificar e te retorno", "já te aviso"). Você não reabre a conversa por conta própria: quem responde depois é uma pessoa da equipe, e ela só fica sabendo se você acionar a ferramenta de transferência.',
      'Quando não souber, quando pedirem uma pessoa, ou quando o assunto for sensível: acione a ferramenta de transferir NA MESMA resposta e diga que alguém da equipe continua dali. Sem a ferramenta, ninguém é avisado.',
      'Sem a ferramenta de transferência disponível, seja honesta: diga que não tem essa informação e oriente a procurar a equipe pelos canais da empresa — não invente um retorno.',
    ];

    if (params.customerName) {
      lines.push(
        `Você está falando com ${params.customerName}. Use o nome com naturalidade, sem repetir a cada frase.`,
      );
    }

    if (params.customInstructions) {
      lines.push(
        '',
        'Instruções gerais de comportamento:',
        params.customInstructions,
      );
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
    extras: {
      customerMemory?: Record<string, string>;
      pendingFields?: string[];
      customerName?: string | null;
    } = {},
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

    const memoria = extras.customerMemory ?? {};

    return this.buildSystemPrompt({
      tenantName: tenant.name,
      aiName: settings?.aiName ?? 'Assistente',
      tone: settings?.tone ?? 'PROFESSIONAL',
      agora: agoraNoFuso(tenant.timezone),
      customerName: extras.customerName ?? null,
      customInstructions: settings?.customInstructions ?? null,
      instructions,
      relevantChunks,
      // Com a memória desligada, o que já estava guardado também para de ser
      // usado — não é só a gravação nova que fica bloqueada.
      customerMemory: settings?.memoryMode === 'NONE' ? {} : memoria,
      pendingFields: extras.pendingFields ?? [],
    });
  }

  /**
   * O que sabemos deste cliente, e o nome dele.
   *
   * Vêm juntos porque saem da mesma linha do banco — separar custaria uma
   * consulta a mais por resposta, e esta roda em toda mensagem.
   */
  private async carregarCliente(conversationId: string): Promise<{
    nome: string | null;
    memoria: Record<string, string>;
  }> {
    const conversation = await this.tenantPrisma.db.conversation.findFirst({
      where: { id: conversationId },
      select: { customer: { select: { name: true, metadata: true } } },
    });

    const cliente = conversation?.customer;
    // Contato que entrou pelo número não tem nome de verdade — chamar
    // alguém de "5527999998888" é pior que não chamar de nada.
    const nome =
      cliente?.name && !/^\+?\d[\d\s()-]*$/.test(cliente.name.trim())
        ? cliente.name.trim()
        : null;

    const metadata = cliente?.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return { nome, memoria: {} };
    }

    const memoria: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (value === null || typeof value === 'object') continue;
      memoria[key] = String(value);
    }

    // Só os últimos: a memória cresce a cada conversa e as entradas mais
    // recentes são as que descrevem o cliente de hoje.
    const chaves = Object.keys(memoria).slice(-LIMITE_DA_MEMORIA);
    return {
      nome,
      memoria: Object.fromEntries(
        chaves.map((chave) => [chave, memoria[chave]]),
      ),
    };
  }

  /** Nunca deixa uma falha na busca de conhecimento derrubar a resposta da IA. */
  private async searchKnowledgeSafely(query: string): Promise<RelevantChunk[]> {
    try {
      return cabemNoOrcamento(await this.knowledge.searchRelevantChunks(query));
    } catch {
      return [];
    }
  }

  async build(conversationId: string): Promise<AiConversationContext> {
    const messages = await this.tenantPrisma.db.message.findMany({
      where: {
        conversationId,
        // Mensagem apagada não vai pro modelo. O painel já esconde o
        // conteúdo dela; deixá-la aqui faria a IA repetir pro cliente
        // exatamente o texto que alguém apagou pra ele não ver de novo.
        deletedAt: null,
        // Nota interna do sistema ("encaminhado para o setor X") é recado
        // pra equipe, não parte da conversa.
        senderType: { not: 'SYSTEM' },
      },
      orderBy: { createdAt: 'desc' },
      take: LIMITE_DO_HISTORICO,
      select: {
        content: true,
        messageType: true,
        senderType: true,
        // A hora entra pra marcar o salto de tempo entre uma mensagem e a
        // seguinte (ver `marcarSaltoDeTempo`). Não vai pro prompt como
        // carimbo em toda linha: seria caro e não muda nada quando a
        // conversa é contínua.
        createdAt: true,
        replyTo: { select: { content: true, senderType: true } },
      },
    });

    const ordered = messages.reverse();
    const ultimaDoCliente = [...ordered]
      .reverse()
      .find((message) => message.senderType === 'CUSTOMER');

    const pergunta = ultimaDoCliente ? descreverMensagem(ultimaDoCliente) : '';

    const [relevantChunks, cliente, pendingFields] = await Promise.all([
      // A busca só acontece quando há pergunta de verdade. "Oi" e "obrigado"
      // não têm resposta em contrato nenhum, e buscar por eles custa uma
      // chamada de embedding mais alguns milhares de caracteres de prompt.
      mereceBuscaNaBase(pergunta)
        ? this.searchKnowledgeSafely(pergunta)
        : Promise.resolve([]),
      this.carregarCliente(conversationId),
      this.collection.missingRequired(conversationId),
    ]);

    const systemPrompt = await this.buildIdentityPrompt(relevantChunks, {
      customerMemory: cliente.memoria,
      pendingFields,
      customerName: cliente.nome,
    });

    // Anotado, e não convertido: um `as` aqui é apagado pela regra de
    // asserção desnecessária do lint, e sem ele o TypeScript alarga `role`
    // pra `string` — que deixa de casar com o contrato do provedor.
    const turnos = ordered.map((message) => ({
      role: message.senderType === 'CUSTOMER' ? 'user' : 'assistant',
      createdAt: message.createdAt,
      content: encurtar(
        // A citação entra junto porque a mensagem original pode estar
        // fora das vinte carregadas: sem ela, "sim, esse mesmo" chega
        // sem nada a que se referir.
        message.replyTo
          ? `(respondendo a: "${encurtar(message.replyTo.content, 160)}")\n${descreverMensagem(message)}`
          : descreverMensagem(message),
        LIMITE_POR_MENSAGEM,
      ).trim(),
    }));

    // Descartar ANTES de juntar, não depois: uma mensagem vazia entre duas
    // falas do mesmo lado sobreviveria grudada na anterior, e o turno
    // chegaria no modelo com uma linha em branco no meio.
    //
    // A marca de tempo vem antes de juntar pelo mesmo motivo: ela pertence
    // à mensagem que chegou depois da pausa, e depois de juntar já não dá
    // pra saber qual era.
    const history = juntarTurnosSeguidos(
      marcarSaltoDeTempo(turnos.filter((turno) => turno.content.length > 0)),
    ) as AiMessage[];

    return { systemPrompt, history };
  }

  /** Usado pelo simulador (/ai/simulate) — sem conversa real, só a mensagem digitada na hora. */
  async buildStandalone(message: string): Promise<AiConversationContext> {
    const relevantChunks = mereceBuscaNaBase(message)
      ? await this.searchKnowledgeSafely(message)
      : [];
    const systemPrompt = await this.buildIdentityPrompt(relevantChunks);
    return { systemPrompt, history: [{ role: 'user', content: message }] };
  }
}
