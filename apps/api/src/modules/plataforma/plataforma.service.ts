import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { decidirAcesso } from '../billing/acesso';
import { emailsDaPlataforma } from './plataforma.guard';

const DIA_MS = 24 * 60 * 60 * 1000;

/** O preço do plano, pra estimar a receita recorrente (MRR). */
function precoMensal(): number {
  const valor = Number(process.env.PLANO_PRECO_MENSAL ?? 147);
  return Number.isFinite(valor) && valor > 0 ? valor : 147;
}

/** Os nomes que o cadastro grava em `comoConheceu`, e como aparecem. */
export const ORIGENS: Record<string, string> = {
  instagram: 'Instagram',
  indicacao: 'Indicação de alguém',
  google: 'Google',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  whatsapp: 'Grupo ou mensagem no WhatsApp',
  outro: 'Outro',
};

export type SituacaoDaCobranca =
  | 'plataforma'
  | 'liberada'
  | 'pagante'
  | 'carencia'
  | 'cancelada'
  | 'pendente'
  | 'sem_assinatura';

/**
 * A situação de cada conta, lida da MESMA régua que decide o acesso
 * (decidirAcesso) — o painel nunca mostra "liberada" pra uma conta que o
 * guard está bloqueando, nem o contrário.
 */
export function situacaoDaCobranca(
  conta:
    | {
        stripeSubscriptionId: string | null;
        planLabel: string;
        assinaturaVencidaEm: Date | null;
        liberadoAte?: Date | null;
      }
    | null
    | undefined,
  { daPlataforma = false, agora = Date.now() } = {},
): SituacaoDaCobranca {
  const { motivo } = decidirAcesso(conta, { daPlataforma, agora });
  if (motivo === 'plataforma') return 'plataforma';
  if (motivo === 'liberado') return 'liberada';
  if (motivo === 'assinatura') return 'pagante';
  if (motivo === 'carencia') return 'carencia';
  if (conta?.planLabel === 'Cancelada') return 'cancelada';
  return conta?.assinaturaVencidaEm ? 'pendente' : 'sem_assinatura';
}

/** Já assinou alguma vez (mesmo que hoje esteja cancelada ou atrasada). */
function jaAssinou(
  conta: { stripeCustomerId: string | null; planLabel: string } | null,
) {
  return (
    Boolean(conta?.stripeCustomerId) ||
    (conta?.planLabel ?? 'Grátis') !== 'Grátis'
  );
}

const numero = (valor: unknown) => Number(valor ?? 0);

/**
 * Os relatórios do dono da plataforma.
 *
 * Tudo sai do que o sistema já guarda — conta, cobrança, conexão, mensagens
 * — mais os poucos passos que só existem como evento (visita, clique,
 * abertura do pagamento, acesso ao painel; ver RegistroDeEventos). Cliente
 * cru do Prisma de propósito: é a única tela que olha TODAS as empresas.
 */
@Injectable()
export class PlataformaService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /** As empresas em que alguém é dono da plataforma (PLATFORM_ADMIN_EMAILS). */
  private async empresasDaPlataforma(): Promise<Set<string>> {
    const lista = emailsDaPlataforma();
    if (lista.length === 0) return new Set();
    const donos = await this.db.user.findMany({
      where: { email: { in: lista, mode: 'insensitive' } },
      select: { tenantId: true },
    });
    return new Set(donos.map((d) => d.tenantId));
  }

  /** Quantos visitantes/pessoas/empresas distintos fizeram um passo. */
  private async distintos(
    campo: 'visitante' | 'userId' | 'tenantId',
    tipo: string,
    desde: Date,
    ate = new Date(),
    tenants?: string[],
  ): Promise<number> {
    const coluna = Prisma.raw(`"${campo}"`);
    const filtroDeTenant =
      tenants === undefined
        ? Prisma.empty
        : tenants.length === 0
          ? Prisma.sql`AND FALSE`
          : Prisma.sql`AND "tenantId" IN (${Prisma.join(tenants)})`;
    const [linha] = await this.db.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(DISTINCT ${coluna}) AS total
      FROM "eventos_da_plataforma"
      WHERE "tipo" = ${tipo} AND "createdAt" >= ${desde} AND "createdAt" < ${ate}
        AND ${coluna} IS NOT NULL ${filtroDeTenant}`;
    return numero(linha?.total);
  }

  async relatorio(dias: number) {
    const agora = new Date();
    const desde = new Date(agora.getTime() - dias * DIA_MS);
    const [resumo, funil, origens, serie] = await Promise.all([
      this.resumo(agora, desde),
      this.funil(desde),
      this.origens(desde),
      this.serieDiaria(desde, dias),
    ]);
    return {
      periodo: { dias, desde, ate: agora },
      resumo,
      funil,
      origens,
      serie,
    };
  }

  /** Os números da primeira dobra, com os alertas que pedem ação. */
  private async resumo(agora: Date, desde: Date) {
    const umDia = new Date(agora.getTime() - DIA_MS);
    const semana = new Date(agora.getTime() - 7 * DIA_MS);
    const mes = new Date(agora.getTime() - 30 * DIA_MS);

    const [
      contasTotal,
      contasNovas,
      cobrancas,
      usuariosTotal,
      ativosDia,
      ativosSemana,
      ativosMes,
      conexoes,
      mensagens,
      respostasIa,
      conversasNovas,
      errosDia,
      errosAbertos,
      pacotes,
    ] = await Promise.all([
      this.db.tenant.count(),
      this.db.tenant.count({ where: { createdAt: { gte: desde } } }),
      this.db.billingAccount.findMany({
        select: {
          tenantId: true,
          stripeSubscriptionId: true,
          stripeCustomerId: true,
          planLabel: true,
          assinaturaVencidaEm: true,
          liberadoAte: true,
        },
      }),
      this.db.user.count({ where: { status: 'ACTIVE' } }),
      this.distintos('userId', 'painel_acesso', umDia),
      this.distintos('userId', 'painel_acesso', semana),
      this.distintos('userId', 'painel_acesso', mes),
      this.db.evolutionSettings.findMany({
        select: { tenantId: true, estado: true },
      }),
      this.db.message.count({ where: { createdAt: { gte: desde } } }),
      this.db.message.count({
        where: { createdAt: { gte: desde }, senderType: 'AI' },
      }),
      this.db.conversation.count({ where: { createdAt: { gte: desde } } }),
      this.db.erroDaPlataforma.count({ where: { ultimaVez: { gte: umDia } } }),
      this.db.erroDaPlataforma.count({ where: { resolvido: false } }),
      this.db.eventoDaPlataforma.count({
        where: { tipo: 'pacote_pago', createdAt: { gte: desde } },
      }),
    ]);

    const daPlataforma = await this.empresasDaPlataforma();
    const porSituacao: Record<SituacaoDaCobranca, number> = {
      plataforma: 0,
      liberada: 0,
      pagante: 0,
      carencia: 0,
      cancelada: 0,
      pendente: 0,
      sem_assinatura: 0,
    };
    // Receita é quem tem assinatura no Stripe — inclusive quem também
    // ganhou dias de folga (aparece como "liberada", mas continua pagando).
    const pagantes = new Set<string>();
    for (const conta of cobrancas) {
      const situacao = situacaoDaCobranca(conta, {
        daPlataforma: daPlataforma.has(conta.tenantId),
        agora: agora.getTime(),
      });
      porSituacao[situacao] += 1;
      if (conta.stripeSubscriptionId) pagantes.add(conta.tenantId);
    }
    // Conta sem linha de cobrança nunca abriu o pagamento.
    porSituacao.sem_assinatura += Math.max(0, contasTotal - cobrancas.length);

    const conectadas = new Set(
      conexoes.filter((c) => c.estado === 'CONECTADO').map((c) => c.tenantId),
    );
    const pagantesSemWhatsapp = [...pagantes].filter(
      (id) => !conectadas.has(id),
    ).length;

    const cancelamentos = await this.db.eventoDaPlataforma.count({
      where: { tipo: 'assinatura_cancelada', createdAt: { gte: desde } },
    });

    return {
      contas: { total: contasTotal, novas: contasNovas, ...porSituacao },
      receita: {
        mrr: pagantes.size * precoMensal(),
        assinantes: pagantes.size,
        precoMensal: precoMensal(),
        pacotesExtras: pacotes,
        cancelamentos,
      },
      uso: {
        usuarios: usuariosTotal,
        ativosDia,
        ativosSemana,
        ativosMes,
        whatsappConectados: conectadas.size,
        mensagens,
        respostasIa,
        conversasNovas,
      },
      alertas: {
        pagantesSemWhatsapp,
        emCarencia: porSituacao.carencia,
        errosDia,
        errosAbertos,
      },
    };
  }

  /**
   * Onde as pessoas desistem.
   *
   * Até o cadastro, conta visitante distinto no período (é o que existe
   * antes da conta). Do cadastro em diante, é a TURMA de contas criadas no
   * período, e cada passo diz quantas delas já chegaram lá — assim a queda
   * de um passo pro outro é gente de verdade que parou naquele ponto.
   */
  private async funil(desde: Date) {
    const turma = await this.db.tenant.findMany({
      where: { createdAt: { gte: desde } },
      select: { id: true },
    });
    const ids = turma.map((t) => t.id);
    const semana = new Date(Date.now() - 7 * DIA_MS);

    const [
      visitas,
      cta,
      cadastroAberto,
      abriuPagamento,
      cobrancas,
      whatsapp,
      iaRespondeu,
      ativos,
    ] = await Promise.all([
      this.distintos('visitante', 'landing_visita', desde),
      this.distintos('visitante', 'landing_cta', desde),
      this.distintos('visitante', 'cadastro_aberto', desde),
      this.distintos('tenantId', 'checkout_iniciado', desde, undefined, ids),
      this.db.billingAccount.findMany({
        where: { tenantId: { in: ids } },
        select: { stripeCustomerId: true, planLabel: true },
      }),
      this.db.evolutionSettings.count({
        where: {
          tenantId: { in: ids },
          OR: [{ estado: 'CONECTADO' }, { connectedPhone: { not: null } }],
        },
      }),
      ids.length
        ? this.db.$queryRaw<{ total: bigint }[]>`
            SELECT COUNT(DISTINCT "tenantId") AS total FROM "messages"
            WHERE "senderType" = 'AI' AND "tenantId" IN (${Prisma.join(ids)})`
        : Promise.resolve([{ total: BigInt(0) }]),
      this.distintos('tenantId', 'painel_acesso', semana, undefined, ids),
    ]);

    return [
      { chave: 'visitas', rotulo: 'Visitaram a página', valor: visitas },
      { chave: 'cta', rotulo: 'Clicaram em começar', valor: cta },
      {
        chave: 'cadastro',
        rotulo: 'Abriram o cadastro',
        valor: cadastroAberto,
      },
      { chave: 'conta', rotulo: 'Criaram a conta', valor: ids.length },
      {
        chave: 'pagamento',
        rotulo: 'Abriram o pagamento',
        valor: abriuPagamento,
      },
      {
        chave: 'assinatura',
        rotulo: 'Assinaram',
        valor: cobrancas.filter((c) => jaAssinou(c)).length,
      },
      { chave: 'whatsapp', rotulo: 'Conectaram o WhatsApp', valor: whatsapp },
      {
        chave: 'ia',
        rotulo: 'A IA respondeu um cliente',
        valor: numero(iaRespondeu[0]?.total),
      },
      { chave: 'ativos', rotulo: 'Usaram na última semana', valor: ativos },
    ];
  }

  /** De onde vieram as contas do período, e quantas de cada origem pagaram. */
  private async origens(desde: Date) {
    const contas = await this.db.tenant.findMany({
      where: { createdAt: { gte: desde } },
      select: {
        comoConheceu: true,
        comoConheceuDetalhe: true,
        utm: true,
        billing: { select: { stripeCustomerId: true, planLabel: true } },
      },
    });

    const porOrigem = new Map<
      string,
      { contas: number; assinaram: number; detalhes: string[] }
    >();
    const porCampanha = new Map<
      string,
      { contas: number; assinaram: number }
    >();
    for (const conta of contas) {
      const chave = conta.comoConheceu ?? 'nao_informado';
      const linha = porOrigem.get(chave) ?? {
        contas: 0,
        assinaram: 0,
        detalhes: [],
      };
      linha.contas += 1;
      if (jaAssinou(conta.billing)) linha.assinaram += 1;
      if (conta.comoConheceuDetalhe && linha.detalhes.length < 20) {
        linha.detalhes.push(conta.comoConheceuDetalhe);
      }
      porOrigem.set(chave, linha);

      const utm = (conta.utm ?? {}) as Record<string, unknown>;
      const fonte = typeof utm.utm_source === 'string' ? utm.utm_source : null;
      if (fonte) {
        const campanha =
          typeof utm.utm_campaign === 'string' ? ` · ${utm.utm_campaign}` : '';
        const nome = `${fonte}${campanha}`;
        const c = porCampanha.get(nome) ?? { contas: 0, assinaram: 0 };
        c.contas += 1;
        if (jaAssinou(conta.billing)) c.assinaram += 1;
        porCampanha.set(nome, c);
      }
    }

    return {
      comoConheceu: [...porOrigem.entries()]
        .map(([chave, linha]) => ({
          chave,
          rotulo:
            chave === 'nao_informado'
              ? 'Não informado'
              : (ORIGENS[chave] ?? chave),
          ...linha,
        }))
        .sort((a, b) => b.contas - a.contas),
      campanhas: [...porCampanha.entries()]
        .map(([nome, linha]) => ({ nome, ...linha }))
        .sort((a, b) => b.contas - a.contas),
    };
  }

  /** Um ponto por dia: visitas, contas, assinaturas, pessoas ativas, mensagens. */
  private async serieDiaria(desde: Date, dias: number) {
    const porDia = <T extends { dia: Date; total: bigint }>(linhas: T[]) =>
      new Map(
        linhas.map((l) => [l.dia.toISOString().slice(0, 10), numero(l.total)]),
      );

    const [visitas, contas, assinaturas, ativos, mensagens] = await Promise.all(
      [
        this.db.$queryRaw<{ dia: Date; total: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS dia, COUNT(DISTINCT "visitante") AS total
        FROM "eventos_da_plataforma"
        WHERE "tipo" = 'landing_visita' AND "createdAt" >= ${desde}
        GROUP BY 1`,
        this.db.$queryRaw<{ dia: Date; total: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS dia, COUNT(*) AS total
        FROM "tenants" WHERE "createdAt" >= ${desde} GROUP BY 1`,
        this.db.$queryRaw<{ dia: Date; total: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS dia, COUNT(*) AS total
        FROM "eventos_da_plataforma"
        WHERE "tipo" = 'assinatura_ativa' AND "createdAt" >= ${desde}
        GROUP BY 1`,
        this.db.$queryRaw<{ dia: Date; total: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS dia, COUNT(DISTINCT "userId") AS total
        FROM "eventos_da_plataforma"
        WHERE "tipo" = 'painel_acesso' AND "createdAt" >= ${desde}
        GROUP BY 1`,
        this.db.$queryRaw<{ dia: Date; total: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS dia, COUNT(*) AS total
        FROM "messages" WHERE "createdAt" >= ${desde} GROUP BY 1`,
      ],
    );

    const mapas = {
      visitas: porDia(visitas),
      contas: porDia(contas),
      assinaturas: porDia(assinaturas),
      ativos: porDia(ativos),
      mensagens: porDia(mensagens),
    };

    return Array.from({ length: dias }, (_, i) => {
      const dia = new Date(desde.getTime() + (i + 1) * DIA_MS)
        .toISOString()
        .slice(0, 10);
      return {
        dia,
        visitas: mapas.visitas.get(dia) ?? 0,
        contas: mapas.contas.get(dia) ?? 0,
        assinaturas: mapas.assinaturas.get(dia) ?? 0,
        ativos: mapas.ativos.get(dia) ?? 0,
        mensagens: mapas.mensagens.get(dia) ?? 0,
      };
    });
  }

  /** Todas as empresas, com o que diz se estão dando certo. */
  async contas(busca?: string) {
    const termo = busca?.trim();
    const mes = new Date(Date.now() - 30 * DIA_MS);
    const tenants = await this.db.tenant.findMany({
      where: termo
        ? {
            OR: [
              { name: { contains: termo, mode: 'insensitive' } },
              {
                users: {
                  some: { email: { contains: termo, mode: 'insensitive' } },
                },
              },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: {
        id: true,
        name: true,
        createdAt: true,
        comoConheceu: true,
        billing: {
          select: {
            stripeSubscriptionId: true,
            planLabel: true,
            assinaturaVencidaEm: true,
            liberadoAte: true,
            liberadoNota: true,
            aiRepliesUsed: true,
            aiMonthlyMessageLimit: true,
            aiExtraMessagesThisPeriod: true,
          },
        },
        evolutionSettings: { select: { estado: true, connectedPhone: true } },
        users: {
          select: { email: true, name: true, role: true, ultimoAcessoEm: true },
        },
      },
    });

    const ids = tenants.map((t) => t.id);
    const conversas = ids.length
      ? await this.db.conversation.groupBy({
          by: ['tenantId'],
          where: { tenantId: { in: ids }, createdAt: { gte: mes } },
          _count: { _all: true },
        })
      : [];
    const conversasPorConta = new Map(
      conversas.map((c) => [c.tenantId, c._count._all]),
    );
    const daPlataforma = await this.empresasDaPlataforma();

    return tenants.map((t) => {
      const dono = t.users.find((u) => u.role === 'OWNER') ?? t.users[0];
      const ultimoAcesso = t.users
        .map((u) => u.ultimoAcessoEm?.getTime() ?? 0)
        .reduce((a, b) => Math.max(a, b), 0);
      return {
        id: t.id,
        nome: t.name,
        criadaEm: t.createdAt,
        dono: dono ? { nome: dono.name, email: dono.email } : null,
        origem: t.comoConheceu
          ? (ORIGENS[t.comoConheceu] ?? t.comoConheceu)
          : null,
        cobranca: situacaoDaCobranca(t.billing, {
          daPlataforma: daPlataforma.has(t.id),
        }),
        liberadoAte: t.billing?.liberadoAte ?? null,
        liberadoNota: t.billing?.liberadoNota ?? null,
        temAssinatura: Boolean(t.billing?.stripeSubscriptionId),
        daPlataforma: daPlataforma.has(t.id),
        usuarios: t.users.length,
        whatsapp: t.evolutionSettings?.estado ?? null,
        conversas30d: conversasPorConta.get(t.id) ?? 0,
        ia: t.billing
          ? {
              usadas: t.billing.aiRepliesUsed,
              limite:
                t.billing.aiMonthlyMessageLimit +
                t.billing.aiExtraMessagesThisPeriod,
            }
          : null,
        ultimoAcesso: ultimoAcesso ? new Date(ultimoAcesso) : null,
      };
    });
  }

  async erros(todos = false) {
    return this.db.erroDaPlataforma.findMany({
      where: todos ? undefined : { resolvido: false },
      orderBy: { ultimaVez: 'desc' },
      take: 200,
    });
  }

  async resolverErro(id: string) {
    await this.db.erroDaPlataforma.updateMany({
      where: { id },
      data: { resolvido: true },
    });
    return { ok: true };
  }
}
