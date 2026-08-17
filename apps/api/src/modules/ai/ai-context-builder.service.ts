import { Injectable } from '@nestjs/common';
import type { AiTone } from '../../../generated/prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { CollectionService } from '../collection/collection.service';
import { InboxSettingsService } from '../inbox-settings/inbox-settings.service';
import {
  dentroDoExpediente,
  descreverSemana,
  proximaAbertura,
} from '../inbox-settings/horario-comercial';
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
import { TranscricaoService } from './transcricao.service';

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
    private readonly inboxSettings: InboxSettingsService,
    private readonly transcricao: TranscricaoService,
  ) {}

  /**
   * O que o cliente FALOU entra no histórico como texto.
   *
   * A IA transcreve sempre, e isto não passa pela configuração do dono: a
   * escolha dele vale pro atendente humano, que consegue ouvir. Sem
   * transcrição, o áudio chegava ao modelo como "[o cliente enviou um
   * áudio, que você não consegue abrir]" — e num escritório onde boa parte
   * do cliente prefere falar a digitar, isso é metade do atendimento fora
   * do alcance dela.
   *
   * Custa uma chamada a mais só na PRIMEIRA vez: a transcrição fica
   * guardada na mensagem, então o próximo turno da mesma conversa a lê do
   * banco.
   *
   * Falhar aqui não impede a resposta — a mensagem volta ao marcador de
   * antes, e o modelo ao menos sabe que houve um áudio.
   */
  private async comAudioTranscrito<
    T extends { id: string; messageType: string; content: string },
  >(mensagens: T[]): Promise<T[]> {
    const audios = mensagens.filter((m) => m.messageType === 'AUDIO');
    if (audios.length === 0) return mensagens;

    const textos = new Map<string, string>();
    for (const audio of audios) {
      const texto = await this.transcricao.transcrever(audio.id);
      if (texto) textos.set(audio.id, texto);
    }

    return mensagens.map((mensagem) => {
      const texto = textos.get(mensagem.id);
      if (!texto) return mensagem;
      // Vira TEXT porque, pro modelo, deixou de ser um anexo ilegível e
      // passou a ser fala. Manter AUDIO faria `descreverMensagem` colar o
      // marcador de "não consigo abrir" na frente da transcrição.
      return { ...mensagem, messageType: 'TEXT', content: texto };
    });
  }

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
    expediente: { semana: string[]; aberto: boolean; volta: string | null };
  }): string {
    const lines = [
      `Você é ${params.aiName}, a assistente de atendimento da empresa "${params.tenantName}".`,
      // A IA não tem relógio próprio. Sem esta linha ela falava em "hoje" e
      // "amanhã" sem saber que dia era, e marcava coisa pra domingo numa
      // empresa que atende de segunda a sexta.
      `Agora é ${params.agora} (fuso da empresa). Use isto pra qualquer conta de data ou horário.`,
      `Fale em português do Brasil, em tom ${TONE_DESCRIPTION[params.tone]}.`,
      'Escreva como quem manda mensagem de WhatsApp: direto, parágrafos curtos, no máximo umas quatro linhas. Se a resposta for longa, mande o essencial e ofereça o resto.',
      // A lista é literal porque a versão genérica ("não invente") não
      // segurou: pediram o endereço, a base não tinha, e a IA respondeu uma
      // avenida em outro estado. Nomear os dados que mais causam estrago
      // dá ao modelo uma regra que ele consegue aplicar. A trava
      // determinística que confere isso depois está em ai-fatos.ts — esta
      // linha é a primeira barreira, não a única.
      'Nunca invente dado da empresa. Endereço, telefone, e-mail, preço, prazo, CNPJ e política só podem ser ditos se aparecerem LITERALMENTE nas instruções ou nos trechos de conhecimento abaixo. Não deduza, não estime, não use exemplo genérico e não complete com o que costuma ser verdade em empresas parecidas.',
      'Se te perguntarem um desses dados e ele não estiver aqui, diga que vai confirmar com a equipe e acione a ferramenta de transferência. É melhor não responder do que responder errado.',
      // Regra dura: a IA não tem como voltar sozinha numa conversa depois.
      // Sem isso ela promete "já te retorno", ninguém é avisado, e o
      // cliente fica esperando um retorno que nunca vem.
      'NUNCA prometa retornar depois ("vou verificar e te retorno", "já te aviso"). Você não reabre a conversa por conta própria: quem responde depois é uma pessoa da equipe, e ela só fica sabendo se você acionar a ferramenta de transferência.',
      'Quando não souber, quando pedirem uma pessoa, ou quando o assunto for sensível: acione a ferramenta de transferir NA MESMA resposta e diga que alguém da equipe continua dali. Sem a ferramenta, ninguém é avisado.',
      'Sem a ferramenta de transferência disponível, seja honesta: diga que não tem essa informação e oriente a procurar a equipe pelos canais da empresa — não invente um retorno.',
    ];

    /**
     * O expediente da empresa.
     *
     * Duas coisas diferentes entram aqui, e as duas faltavam. A primeira é
     * a pergunta direta — "que horas vocês abrem?" — que antes só tinha
     * resposta se alguém tivesse escrito o horário à mão numa instrução, em
     * duplicata com a configuração. A segunda é o que a IA promete: fora do
     * expediente, "vou passar pra equipe agora" é falso, porque não há
     * equipe até segunda. Dizer quando alguém volta é a diferença entre um
     * cliente que espera sabendo e um que espera no escuro.
     *
     * Transferir continua valendo fora do horário: a conversa fica na fila
     * pra quem abrir amanhã. O que muda é a frase, não o encaminhamento.
     */
    if (params.expediente.semana.length > 0) {
      lines.push('', 'Horário de atendimento da empresa:');
      for (const dia of params.expediente.semana) {
        lines.push(`- ${dia}`);
      }
      lines.push(
        'Nos dias que não estão nesta lista a empresa não atende. Responda sobre horário usando SÓ o que está aqui.',
      );

      if (!params.expediente.aberto) {
        lines.push(
          params.expediente.volta
            ? `AGORA a empresa está FORA do horário de atendimento — a equipe volta ${params.expediente.volta}. Não diga que alguém vai responder "em instantes" nem "ainda hoje": diga quando a equipe volta. Se precisar de uma pessoa, transfira do mesmo jeito (a conversa fica na fila) e explique que alguém responde ${params.expediente.volta}.`
            : 'AGORA a empresa está FORA do horário de atendimento. Não prometa resposta imediata de uma pessoa.',
        );
      }
    }

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

    const [tenant, settings, instructions, expediente] = await Promise.all([
      this.prisma.client.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      this.tenantPrisma.db.aiSettings.findFirst(),
      this.tenantPrisma.db.aiInstruction.findMany({
        where: { active: true },
        orderBy: { priority: 'desc' },
      }),
      this.inboxSettings.expediente(),
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
      expediente: {
        semana: descreverSemana(expediente),
        aberto: dentroDoExpediente(expediente, tenant.timezone),
        volta: proximaAbertura(expediente, tenant.timezone),
      },
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

  /**
   * Onde começa o atendimento atual.
   *
   * Encerrar é uma fronteira: o que veio antes está resolvido, e a IA não
   * deve enxergar aquilo como conversa em andamento. Sem isto acontecia o
   * seguinte — o atendimento era encerrado depois de a IA passar o caso
   * para o Jurídico, o cliente voltava dias depois com um "Oi", e a IA
   * lia o pedido antigo lá em cima e refazia a transferência. Da parte
   * dela era coerente; para quem estava do outro lado, era um sistema que
   * não percebeu que o assunto já tinha terminado.
   *
   * O que sobrevive à fronteira é a MEMÓRIA do cliente (profissão, como
   * prefere ser chamado), que entra pelo prompt e não pelo histórico.
   * Assim ele volta a ser tratado como conhecido, mas com assunto novo.
   */
  private async inicioDoAtendimentoAtual(
    conversationId: string,
  ): Promise<Date | null> {
    const reabertura = await this.tenantPrisma.db.message.findFirst({
      where: {
        conversationId,
        senderType: 'SYSTEM',
        // A nota de reabertura é escrita por quem reabre — o cliente que
        // voltou a escrever, ou o atendente que respondeu numa conversa
        // encerrada (ver reabrirParaAgrupamento e reabrirSePreciso).
        content: { contains: 'reaberto' },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    return reabertura?.createdAt ?? null;
  }

  async build(conversationId: string): Promise<AiConversationContext> {
    const desde = await this.inicioDoAtendimentoAtual(conversationId);

    const messages = await this.tenantPrisma.db.message.findMany({
      where: {
        conversationId,
        // Só o atendimento atual: o que veio antes do último encerramento
        // está resolvido (ver `inicioDoAtendimentoAtual`).
        ...(desde ? { createdAt: { gte: desde } } : {}),
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
        // O id só é lido aqui pra transcrever o áudio logo abaixo.
        id: true,
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

    const ordered = (await this.comAudioTranscrito(messages)).reverse();
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
