import { Injectable } from '@nestjs/common';
import type {
  ConversationStatus,
  Prisma,
  UserRole,
} from '../../../generated/prisma/client';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { descreverMensagem } from '../ai/ai-context';
import { InboxSettingsService } from '../inbox-settings/inbox-settings.service';
import { fusoValido } from '../inbox-settings/horario-comercial';
import { normalizar } from './propostas';
import { meiaNoite, partes } from '../../common/utils/fuso';

export { meiaNoite };

/** Quem está perguntando — é o que decide que conversas ele pode ler. */
export interface Leitor {
  userId: string;
  role: UserRole;
}

export type Periodo = 'hoje' | 'ontem' | '7dias' | '30dias' | 'mes';
export const PERIODOS: Periodo[] = ['hoje', 'ontem', '7dias', '30dias', 'mes'];

const ABERTAS: ConversationStatus[] = [
  'OPEN',
  'WAITING_CUSTOMER',
  'WAITING_AGENT',
];

/**
 * As notas que a IA deixa quando passa a conversa pra equipe.
 *
 * São as frases de `transferToQueue` (ferramenta da IA) e de
 * `aplicarTravasDaIa` (quando o sistema escala por ela). Ler pelo começo
 * da frase é frágil, mas é o único rastro que sobrevive à reabertura — o
 * `escalationReason` da conversa é apagado quando o cliente volta.
 */
const NOTAS_DE_TRANSFERENCIA_DA_IA = [
  'IA direcionou',
  'IA encaminhou',
  'IA solicitou atendimento humano',
  'Encaminhado para a equipe:',
];

/**
 * Transferência que não é "a IA não soube": a IA estava desligada, sem
 * cota ou fora do ar. Não há o que ensinar nesses casos.
 */
const MOTIVOS_QUE_NAO_SAO_DUVIDA = ['atendimento automático'];

const MINUTO = 60 * 1000;
const DIA = 24 * 60 * MINUTO;

function encurtar(texto: string, limite: number): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo;
}

/** "há 2 h 5 min" — o modelo repete o que recebe, então já vai pronto. */
export function duracao(ms: number): string {
  const minutos = Math.max(0, Math.round(ms / MINUTO));
  if (minutos < 1) return 'menos de 1 min';
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas < 48) return resto ? `${horas} h ${resto} min` : `${horas} h`;
  return `${Math.floor(horas / 24)} dias`;
}

function media(valores: number[]): number | null {
  if (valores.length === 0) return null;
  return valores.reduce((soma, v) => soma + v, 0) / valores.length;
}

export function intervaloDoPeriodo(
  periodo: Periodo,
  fuso: string,
  agora = new Date(),
): { de: Date; ate: Date; rotulo: string } {
  const hoje = meiaNoite(fuso, agora);
  switch (periodo) {
    case 'ontem':
      return {
        de: meiaNoite(fuso, new Date(hoje.getTime() - DIA / 2)),
        ate: hoje,
        rotulo: 'ontem',
      };
    case '7dias':
      return {
        de: meiaNoite(fuso, new Date(hoje.getTime() - 6 * DIA + DIA / 2)),
        ate: agora,
        rotulo: 'últimos 7 dias (com hoje)',
      };
    case '30dias':
      return {
        de: meiaNoite(fuso, new Date(hoje.getTime() - 29 * DIA + DIA / 2)),
        ate: agora,
        rotulo: 'últimos 30 dias (com hoje)',
      };
    case 'mes': {
      const p = partes(fuso, agora);
      const diasAtras = p.dia - 1;
      return {
        de: meiaNoite(
          fuso,
          new Date(hoje.getTime() - diasAtras * DIA + DIA / 2),
        ),
        ate: agora,
        rotulo: 'este mês',
      };
    }
    default:
      return { de: hoje, ate: agora, rotulo: 'hoje' };
  }
}

const DIAS_DA_SEMANA = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
];

/**
 * O que o assistente do painel LÊ: conversas, relatório, o que a IA não
 * soube e o que pede atenção agora.
 *
 * Separado do CopilotService porque é outra natureza de trabalho — aqui é
 * só consulta, e tudo que toca conversa passa pelo mesmo recorte de
 * visibilidade do Inbox: o assistente não pode ser o atalho pra ler a
 * conversa de um setor que a tela esconde da pessoa.
 */
@Injectable()
export class CopilotLeituraService {
  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly inboxSettings: InboxSettingsService,
  ) {}

  private async fuso(): Promise<string> {
    const tenant = await this.prisma.db.tenant.findUnique({
      where: { id: this.prisma.tenantId },
      select: { timezone: true },
    });
    return fusoValido(tenant?.timezone ?? 'America/Sao_Paulo');
  }

  /** A mesma regra de `recorteDeVisibilidade` do Inbox. */
  async visiveis(leitor: Leitor): Promise<Prisma.ConversationWhereInput> {
    if (leitor.role === 'OWNER' || leitor.role === 'ADMIN') return {};
    const settings = await this.inboxSettings.get();
    if (settings.queueVisibility === 'ALL') return {};
    const setores = await this.prisma.db.queueMember.findMany({
      where: { userId: leitor.userId },
      select: { queueId: true },
    });
    return {
      OR: [
        { queueId: null },
        { queueId: { in: setores.map((s) => s.queueId) } },
        { assignedUserId: leitor.userId },
      ],
    };
  }

  /** Clientes cujo nome ou telefone batem com o que foi dito. */
  private async clientesPorNome(texto: string) {
    const digitos = texto.replace(/\D/g, '');
    const termo = texto.trim();
    const candidatos = await this.prisma.db.customer.findMany({
      where: {
        OR: [
          { name: { contains: termo, mode: 'insensitive' } },
          ...(digitos.length >= 4 ? [{ phone: { contains: digitos } }] : []),
        ],
      },
      select: { id: true },
      take: 50,
    });
    if (candidatos.length > 0) return candidatos.map((c) => c.id);

    // "joao" não acha "João" no `contains` do banco: sem acento, compara
    // aqui, com uma lista curta dos clientes com conversa recente.
    const alvo = normalizar(termo);
    const recentes = await this.prisma.db.customer.findMany({
      select: { id: true, name: true },
      orderBy: { updatedAt: 'desc' },
      take: 2000,
    });
    return recentes
      .filter((c) => normalizar(c.name).includes(alvo))
      .slice(0, 50)
      .map((c) => c.id);
  }

  async buscarConversas(
    args: {
      cliente?: string;
      situacao?: string;
      periodo?: string;
      setor?: string;
      limite?: number;
    },
    leitor: Leitor,
  ) {
    const fuso = await this.fuso();
    const agora = new Date();
    const filtros: Prisma.ConversationWhereInput[] = [
      await this.visiveis(leitor),
    ];

    if (args.cliente?.trim()) {
      const ids = await this.clientesPorNome(args.cliente);
      if (ids.length === 0) {
        return {
          conversas: [],
          observacao: 'Nenhum cliente com esse nome ou telefone.',
        };
      }
      filtros.push({ customerId: { in: ids } });
    }

    switch (args.situacao) {
      case 'esperando_resposta':
        filtros.push({
          waitingSince: { not: null },
          status: { in: ABERTAS },
        });
        break;
      case 'sem_responsavel':
        filtros.push({ assignedUserId: null, status: { in: ABERTAS } });
        break;
      case 'com_a_ia':
        filtros.push({ aiMode: 'AI_ACTIVE', status: { in: ABERTAS } });
        break;
      case 'encerradas':
        filtros.push({ status: { in: ['RESOLVED', 'CLOSED'] } });
        break;
      case 'abertas':
        filtros.push({ status: { in: ABERTAS } });
        break;
      default:
        break;
    }

    if (args.periodo && (PERIODOS as string[]).includes(args.periodo)) {
      const { de, ate } = intervaloDoPeriodo(args.periodo as Periodo, fuso);
      filtros.push({ lastMessageAt: { gte: de, lte: ate } });
    }

    if (args.setor?.trim()) {
      const alvo = normalizar(args.setor);
      const setores = await this.prisma.db.queue.findMany({
        select: { id: true, name: true },
      });
      const ids = setores
        .filter((s) => normalizar(s.name).includes(alvo))
        .map((s) => s.id);
      filtros.push({ queueId: { in: ids } });
    }

    const limite = Math.min(Math.max(Number(args.limite) || 15, 1), 30);
    const [total, conversas] = await Promise.all([
      this.prisma.db.conversation.count({ where: { AND: filtros } }),
      this.prisma.db.conversation.findMany({
        where: { AND: filtros },
        orderBy:
          args.situacao === 'esperando_resposta'
            ? { waitingSince: 'asc' }
            : { lastMessageAt: 'desc' },
        take: limite,
        select: {
          id: true,
          status: true,
          aiMode: true,
          waitingSince: true,
          lastMessageAt: true,
          escalationReason: true,
          customer: { select: { name: true, phone: true, isGroup: true } },
          assignedUser: { select: { name: true } },
          queue: { select: { name: true } },
          messages: {
            where: { deletedAt: null, senderType: { not: 'SYSTEM' } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              content: true,
              messageType: true,
              senderType: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      mostrando: conversas.length,
      conversas: conversas.map((c) => {
        const ultima = c.messages[0];
        return {
          id: c.id,
          cliente: c.customer.name,
          telefone: c.customer.isGroup ? undefined : c.customer.phone,
          grupo: c.customer.isGroup || undefined,
          situacao: this.situacao(c),
          setor: c.queue?.name,
          responsavel: c.assignedUser?.name,
          esperandoHa: c.waitingSince
            ? duracao(agora.getTime() - c.waitingSince.getTime())
            : undefined,
          motivoDaTransferencia: c.escalationReason ?? undefined,
          ultimaMensagem: ultima
            ? {
                de: this.quem(ultima.senderType),
                texto: encurtar(descreverMensagem(ultima), 160),
                quando: this.quando(fuso, ultima.createdAt, agora),
              }
            : undefined,
        };
      }),
    };
  }

  async lerConversa(
    args: { conversaId?: string; cliente?: string },
    leitor: Leitor,
  ) {
    const fuso = await this.fuso();
    const agora = new Date();
    const visiveis = await this.visiveis(leitor);

    let where: Prisma.ConversationWhereInput | null = null;
    if (args.conversaId) {
      where = { AND: [visiveis, { id: args.conversaId }] };
    } else if (args.cliente?.trim()) {
      const ids = await this.clientesPorNome(args.cliente);
      if (ids.length === 0) {
        return { error: 'Nenhum cliente com esse nome ou telefone.' };
      }
      where = { AND: [visiveis, { customerId: { in: ids } }] };
    }
    if (!where) return { error: 'Diga o cliente ou a conversa.' };

    const candidatas = await this.prisma.db.conversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        aiMode: true,
        waitingSince: true,
        escalationReason: true,
        escalationSummary: true,
        customer: { select: { id: true, name: true, phone: true } },
        assignedUser: { select: { name: true } },
        queue: { select: { name: true } },
        tags: { select: { tag: { select: { name: true } } } },
      },
    });
    if (candidatas.length === 0) {
      return {
        error: 'Conversa não encontrada (ou fora do que você pode ver).',
      };
    }

    // Vários clientes com o mesmo nome: pergunta qual, em vez de chutar.
    const clientes = new Map(
      candidatas.map((c) => [c.customer.id, c.customer]),
    );
    if (!args.conversaId && clientes.size > 1) {
      return {
        ambiguo: true,
        observacao: 'Mais de um cliente com esse nome. Pergunte qual.',
        opcoes: [...clientes.values()].map((c) => ({
          cliente: c.name,
          telefone: c.phone,
        })),
      };
    }

    const conversa = candidatas[0];
    const mensagens = await this.prisma.db.message.findMany({
      where: { conversationId: conversa.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 80,
      select: {
        content: true,
        messageType: true,
        senderType: true,
        senderId: true,
        transcricao: true,
        createdAt: true,
      },
    });
    const ids = [
      ...new Set(mensagens.map((m) => m.senderId).filter(Boolean)),
    ] as string[];
    const pessoas = ids.length
      ? await this.prisma.db.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const nomes = new Map(pessoas.map((p) => [p.id, p.name]));

    return {
      id: conversa.id,
      cliente: conversa.customer.name,
      telefone: conversa.customer.phone,
      situacao: this.situacao(conversa),
      setor: conversa.queue?.name,
      responsavel: conversa.assignedUser?.name,
      etiquetas: conversa.tags.map((t) => t.tag.name),
      esperandoHa: conversa.waitingSince
        ? duracao(agora.getTime() - conversa.waitingSince.getTime())
        : undefined,
      motivoDaTransferencia: conversa.escalationReason ?? undefined,
      resumoDaIa: conversa.escalationSummary ?? undefined,
      mensagensMostradas: mensagens.length,
      mensagens: mensagens.reverse().map((m) => ({
        quando: this.quando(fuso, m.createdAt, agora),
        de:
          m.senderType === 'AGENT' && m.senderId
            ? (nomes.get(m.senderId) ?? 'Atendente')
            : this.quem(m.senderType),
        texto: encurtar(
          m.transcricao ? `[áudio] ${m.transcricao}` : descreverMensagem(m),
          500,
        ),
      })),
    };
  }

  /**
   * O que a IA passou pra equipe no período — com a pergunta do cliente
   * que veio antes e a resposta que a equipe deu depois.
   *
   * A resposta da equipe é o ouro: é exatamente o que falta ensinar. Com
   * ela à vista, o assistente sugere o ensinamento pronto pra aprovar.
   */
  async perguntasQueAIaNaoSoube(args: { periodo?: string }) {
    const fuso = await this.fuso();
    const periodo = (PERIODOS as string[]).includes(args.periodo ?? '')
      ? (args.periodo as Periodo)
      : '7dias';
    const { de, ate, rotulo } = intervaloDoPeriodo(periodo, fuso);

    const notas = await this.prisma.db.message.findMany({
      where: {
        senderType: 'SYSTEM',
        createdAt: { gte: de, lte: ate },
        OR: NOTAS_DE_TRANSFERENCIA_DA_IA.map((inicio) => ({
          content: { startsWith: inicio },
        })),
        conversation: { customer: { isGroup: false } },
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        conversationId: true,
        content: true,
        createdAt: true,
        conversation: { select: { customer: { select: { name: true } } } },
      },
    });

    const itens: {
      conversaId: string;
      cliente: string;
      quando: string;
      motivo: string;
      perguntaDoCliente: string;
      respostaDaEquipe?: string;
    }[] = [];
    const vistas = new Set<string>();
    const agora = new Date();

    for (const nota of notas) {
      const motivo = this.motivoDaNota(nota.content);
      if (
        MOTIVOS_QUE_NAO_SAO_DUVIDA.some((trecho) =>
          normalizar(motivo).includes(normalizar(trecho)),
        )
      ) {
        continue;
      }
      // Uma por conversa: a mesma dúvida transferida três vezes é uma dúvida.
      if (vistas.has(nota.conversationId)) continue;
      vistas.add(nota.conversationId);

      const [antes, depois] = await Promise.all([
        this.prisma.db.message.findMany({
          where: {
            conversationId: nota.conversationId,
            senderType: 'CUSTOMER',
            deletedAt: null,
            createdAt: { lte: nota.createdAt },
          },
          orderBy: { createdAt: 'desc' },
          take: 2,
          select: { content: true, messageType: true, senderType: true },
        }),
        this.prisma.db.message.findFirst({
          where: {
            conversationId: nota.conversationId,
            senderType: 'AGENT',
            deletedAt: null,
            createdAt: { gt: nota.createdAt },
          },
          orderBy: { createdAt: 'asc' },
          select: { content: true, messageType: true, senderType: true },
        }),
      ]);

      itens.push({
        conversaId: nota.conversationId,
        cliente: nota.conversation.customer.name,
        quando: this.quando(fuso, nota.createdAt, agora),
        motivo,
        perguntaDoCliente: encurtar(
          antes
            .reverse()
            .map((m) => descreverMensagem(m))
            .join(' / '),
          300,
        ),
        respostaDaEquipe: depois
          ? encurtar(descreverMensagem(depois), 400)
          : undefined,
      });
      if (itens.length >= 20) break;
    }

    return {
      periodo: rotulo,
      total: itens.length,
      itens,
      observacao:
        itens.length === 0
          ? 'A IA não passou nenhuma conversa pra equipe por dúvida nesse período.'
          : undefined,
    };
  }

  /**
   * "Como foi a semana?" — os números que o dono quer ouvir, já contados.
   *
   * Conta em memória, como a Visão geral: o volume de um período de uma
   * empresa cabe folgado, e parear cada fala do cliente com a resposta
   * seguinte fica legível assim, e não em SQL de janela.
   */
  async relatorio(args: { periodo?: string }) {
    const fuso = await this.fuso();
    const periodo = (PERIODOS as string[]).includes(args.periodo ?? '')
      ? (args.periodo as Periodo)
      : '7dias';
    const { de, ate, rotulo } = intervaloDoPeriodo(periodo, fuso);

    const [mensagens, novas, pessoas] = await Promise.all([
      this.prisma.db.message.findMany({
        where: {
          createdAt: { gte: de, lte: ate },
          conversation: { customer: { isGroup: false } },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          conversationId: true,
          senderType: true,
          senderId: true,
          content: true,
          createdAt: true,
        },
      }),
      this.prisma.db.conversation.count({
        where: {
          createdAt: { gte: de, lte: ate },
          customer: { isGroup: false },
        },
      }),
      this.prisma.db.user.findMany({ select: { id: true, name: true } }),
    ]);
    const nomes = new Map(pessoas.map((p) => [p.id, p.name]));

    const comCliente = new Set<string>();
    const comEquipe = new Set<string>();
    const transferidas = new Set<string>();
    const resolvidas = new Set<string>();
    const motivos = new Map<string, number>();
    const porHora = new Array<number>(24).fill(0);
    const porDia = new Array<number>(7).fill(0);
    const esperando = new Map<string, Date>();
    const tempoIa: number[] = [];
    const tempoEquipe: number[] = [];
    const porAtendente = new Map<
      string,
      { mensagens: number; conversas: Set<string>; tempos: number[] }
    >();

    for (const m of mensagens) {
      if (m.senderType === 'CUSTOMER') {
        comCliente.add(m.conversationId);
        const p = partes(fuso, m.createdAt);
        porHora[p.hora] += 1;
        if (p.semana >= 0) porDia[p.semana] += 1;
        if (!esperando.has(m.conversationId)) {
          esperando.set(m.conversationId, m.createdAt);
        }
        continue;
      }
      if (m.senderType === 'SYSTEM') {
        if (
          NOTAS_DE_TRANSFERENCIA_DA_IA.some((inicio) =>
            m.content.startsWith(inicio),
          )
        ) {
          transferidas.add(m.conversationId);
          const motivo = this.motivoDaNota(m.content);
          motivos.set(motivo, (motivos.get(motivo) ?? 0) + 1);
        }
        if (m.content.startsWith('Encerrado automaticamente')) {
          resolvidas.add(m.conversationId);
        }
        continue;
      }

      const perguntouEm = esperando.get(m.conversationId);
      const tempo = perguntouEm
        ? m.createdAt.getTime() - perguntouEm.getTime()
        : null;
      if (perguntouEm) esperando.delete(m.conversationId);

      if (m.senderType === 'AI') {
        if (tempo !== null) tempoIa.push(tempo);
      } else if (m.senderType === 'AGENT') {
        comEquipe.add(m.conversationId);
        if (tempo !== null) tempoEquipe.push(tempo);
        const chave = m.senderId ?? 'desconhecido';
        const linha = porAtendente.get(chave) ?? {
          mensagens: 0,
          conversas: new Set<string>(),
          tempos: [],
        };
        linha.mensagens += 1;
        linha.conversas.add(m.conversationId);
        if (tempo !== null) linha.tempos.push(tempo);
        porAtendente.set(chave, linha);
      }
    }

    const soIa = [...comCliente].filter(
      (id) => !comEquipe.has(id) && !transferidas.has(id),
    ).length;
    const texto = (ms: number | null) => (ms === null ? null : duracao(ms));
    const picos = porHora
      .map((total, hora) => ({ hora, total }))
      .filter((h) => h.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 3)
      .map((h) => ({
        faixa: `${String(h.hora).padStart(2, '0')}h–${String((h.hora + 1) % 24).padStart(2, '0')}h`,
        mensagensDeClientes: h.total,
      }));

    return {
      periodo: rotulo,
      clientesQueEscreveram: comCliente.size,
      conversasNovas: novas,
      mensagens: {
        deClientes: mensagens.filter((m) => m.senderType === 'CUSTOMER').length,
        daIa: mensagens.filter((m) => m.senderType === 'AI').length,
        daEquipe: mensagens.filter((m) => m.senderType === 'AGENT').length,
      },
      ia: {
        atendeuSozinha: soIa,
        porcentoDosClientes: comCliente.size
          ? Math.round((soIa / comCliente.size) * 100)
          : 0,
        passouParaAEquipe: transferidas.size,
        principaisMotivos: [...motivos.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([motivo, vezes]) => ({ motivo, vezes })),
        tempoMedioDeResposta: texto(media(tempoIa)),
      },
      equipe: {
        conversasAtendidas: comEquipe.size,
        tempoMedioDeResposta: texto(media(tempoEquipe)),
        porAtendente: [...porAtendente.entries()]
          .map(([id, linha]) => ({
            nome: nomes.get(id) ?? 'Ex-integrante',
            conversas: linha.conversas.size,
            mensagens: linha.mensagens,
            tempoMedioDeResposta: texto(media(linha.tempos)),
          }))
          .sort((a, b) => b.conversas - a.conversas),
      },
      horariosDePico: picos,
      diaMaisMovimentado: porDia.some((n) => n > 0)
        ? DIAS_DA_SEMANA[porDia.indexOf(Math.max(...porDia))]
        : null,
      encerradasPorInatividade: resolvidas.size,
      aindaSemResposta: esperando.size,
    };
  }

  /**
   * O que pede atenção agora — o pontinho no ✨.
   *
   * Poucos tipos, e cada um só aparece acima de um limite: aviso que
   * aparece toda hora vira papel de parede, e ninguém mais olha.
   */
  async avisos(leitor: Leitor, podeGerirIa: boolean) {
    const agora = new Date();
    const fuso = await this.fuso();
    const visiveis = await this.visiveis(leitor);
    const avisos: {
      id: string;
      texto: string;
      pergunta: string;
      tom: 'alerta' | 'dica';
    }[] = [];

    const [esperando, whatsapp, tenant] = await Promise.all([
      this.prisma.db.conversation.findMany({
        where: {
          AND: [
            visiveis,
            {
              status: { in: ABERTAS },
              waitingSince: { lte: new Date(agora.getTime() - 30 * MINUTO) },
              customer: { isGroup: false },
            },
          ],
        },
        orderBy: { waitingSince: 'asc' },
        take: 50,
        select: { waitingSince: true },
      }),
      this.prisma.db.evolutionSettings.findFirst({
        select: { estado: true },
      }),
      this.prisma.db.tenant.findUnique({
        where: { id: this.prisma.tenantId },
        select: { canal: true },
      }),
    ]);

    if (
      tenant?.canal === 'EVOLUTION' &&
      whatsapp &&
      whatsapp.estado !== 'CONECTADO'
    ) {
      avisos.push({
        id: 'whatsapp',
        tom: 'alerta',
        texto: 'O WhatsApp está desconectado — nenhuma mensagem entra ou sai.',
        pergunta: 'O WhatsApp está desconectado. O que eu faço?',
      });
    }

    if (esperando.length > 0) {
      const maisAntigo = esperando[0].waitingSince;
      const n = esperando.length;
      avisos.push({
        id: `esperando-${n}`,
        tom: 'alerta',
        texto:
          n === 1
            ? `1 cliente esperando resposta há ${duracao(agora.getTime() - (maisAntigo?.getTime() ?? agora.getTime()))}.`
            : `${n} clientes esperando resposta há mais de 30 min (o mais antigo, há ${duracao(agora.getTime() - (maisAntigo?.getTime() ?? agora.getTime()))}).`,
        pergunta: 'Quem está esperando resposta há mais de 30 minutos?',
      });
    }

    if (podeGerirIa) {
      const hoje = meiaNoite(fuso, agora);
      const notas = await this.prisma.db.message.findMany({
        where: {
          senderType: 'SYSTEM',
          createdAt: { gte: hoje },
          OR: NOTAS_DE_TRANSFERENCIA_DA_IA.map((inicio) => ({
            content: { startsWith: inicio },
          })),
          conversation: { customer: { isGroup: false } },
        },
        select: { content: true, conversationId: true },
        take: 200,
      });
      const porMotivo = new Map<string, Set<string>>();
      const conversas = new Set<string>();
      for (const nota of notas) {
        const motivo = this.motivoDaNota(nota.content);
        if (
          MOTIVOS_QUE_NAO_SAO_DUVIDA.some((trecho) =>
            normalizar(motivo).includes(normalizar(trecho)),
          )
        ) {
          continue;
        }
        conversas.add(nota.conversationId);
        const grupo = porMotivo.get(motivo) ?? new Set<string>();
        grupo.add(nota.conversationId);
        porMotivo.set(motivo, grupo);
      }
      const [motivo, grupo] = [...porMotivo.entries()].sort(
        (a, b) => b[1].size - a[1].size,
      )[0] ?? ['', new Set<string>()];

      if (grupo.size >= 3) {
        avisos.push({
          id: `motivo-${grupo.size}-${normalizar(motivo).slice(0, 30)}`,
          tom: 'dica',
          texto: `A IA passou ${grupo.size} conversas pra equipe hoje pelo mesmo motivo: "${encurtar(motivo, 90)}". Quer ensinar isso a ela?`,
          pergunta:
            'Quais perguntas a IA não soube responder hoje? Sugira o que ensinar a ela.',
        });
      } else if (conversas.size >= 5) {
        avisos.push({
          id: `transferencias-${conversas.size}`,
          tom: 'dica',
          texto: `A IA passou ${conversas.size} conversas pra equipe hoje. Quer ver o que ela não soube?`,
          pergunta:
            'Quais perguntas a IA não soube responder hoje? Sugira o que ensinar a ela.',
        });
      }
    }

    return { avisos };
  }

  private motivoDaNota(conteudo: string): string {
    // "IA encaminhou para o setor "X": <motivo>. Aguardando…" → <motivo>
    const depoisDosDoisPontos = conteudo.includes(':')
      ? conteudo.slice(conteudo.indexOf(':') + 1)
      : conteudo;
    return depoisDosDoisPontos
      .replace(/\.\s*Aguardando.*$/s, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private situacao(c: {
    status: ConversationStatus;
    aiMode: string;
    waitingSince?: Date | null;
  }): string {
    if (c.status === 'RESOLVED' || c.status === 'CLOSED') return 'encerrada';
    if (c.status === 'WAITING_CUSTOMER') return 'esperando o cliente';
    if (c.aiMode === 'AI_ACTIVE') return 'com a IA';
    return c.waitingSince ? 'esperando a equipe responder' : 'com a equipe';
  }

  private quem(senderType: string): string {
    switch (senderType) {
      case 'CUSTOMER':
        return 'Cliente';
      case 'AI':
        return 'IA';
      case 'SYSTEM':
        return 'Nota do sistema';
      default:
        return 'Atendente';
    }
  }

  /** "hoje 14:05", "ontem 09:12", "12/09 18:40" — no fuso da empresa. */
  private quando(fuso: string, data: Date, agora: Date): string {
    const p = partes(fuso, data);
    const hora = `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
    const hoje = meiaNoite(fuso, agora).getTime();
    if (data.getTime() >= hoje) return `hoje ${hora}`;
    if (data.getTime() >= hoje - DIA) return `ontem ${hora}`;
    return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')} ${hora}`;
  }
}
