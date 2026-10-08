import { Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { custoEmDolar } from './preco-do-modelo';
import { cicloMensal, diaNoFuso } from '../../common/utils/fuso';
import { fusoValido } from '../inbox-settings/horario-comercial';

export interface UsoDaIa {
  inputTokens: number;
  outputTokens: number;
}

export interface LimiteDaIa {
  podeResponder: boolean;
  usadas: number;
  limite: number;
  /** Quanto do `limite` veio de pacote avulso comprado, e não do plano. */
  extras: number;
  /** O dia do mês em que o plano renova (o da assinatura). */
  renovaDia: number;
  /** Quando é a próxima renovação. */
  renovaEm: Date;
}

/**
 * O dia do mês em que as respostas renovam: o da assinatura, ou — sem
 * ele — o da criação da conta, que é o mesmo na prática (pagar é a última
 * etapa do cadastro).
 */
export function diaDoCiclo(
  conta: { aiCicloDia: number | null; createdAt: Date },
  fuso: string,
): number {
  return conta.aiCicloDia ?? diaNoFuso(fuso, conta.createdAt);
}

/**
 * Quantas respostas da IA a conta já gastou este mês, e se ainda pode
 * gastar mais.
 *
 * O PORQUÊ DO LIMITE: a chave de IA agora é da plataforma (ver
 * AiCredentialsResolver) — quem paga o provedor por cada resposta é a
 * Bellis, não mais a empresa. Sem um teto, uma conta com um bug de loop
 * no lado do cliente (ou alguém testando o limite de propósito) vira
 * custo direto nosso, sem fim.
 *
 * O NÚMERO NÃO É PALPITE. `gemini-3.1-flash-lite` custa hoje US$0,25 por
 * milhão de tokens de entrada e US$1,50 por milhão de saída (ver
 * preco-do-modelo.ts). Um atendimento típico gira em torno de 2 a 3 mil
 * tokens de entrada — nome da empresa, instruções, regras ativas,
 * histórico recente — e uma resposta curta de WhatsApp fica bem abaixo de
 * 200 de saída: cerca de US$0,0008 por resposta. No pior caso plausível
 * (base de conhecimento grande, histórico cheio, uma chamada de
 * ferramenta no meio) esse custo pode passar de US$0,005. Um teto de 3000
 * respostas por mês (o padrão de `BillingAccount.aiMonthlyMessageLimit`)
 * custa entre ~US$2,40 (caso típico) e ~US$18 (pior caso o mês inteiro,
 * o que não acontece na prática) por conta — pequeno o bastante pra não
 * pesar contra qualquer assinatura, generoso o bastante pra nenhuma
 * empresa de verdade chegar perto no uso normal (100 respostas por dia,
 * todo dia do mês).
 *
 * O QUE NÃO CONTA: mensagem que o cliente manda, mensagem que um
 * atendente humano responde, e qualquer coisa enquanto a IA está
 * desligada. A conexão com o WhatsApp em si (Evolution, ver
 * evolution.service.ts) não tem custo de provedor — é a chamada ao
 * modelo que custa, e só ela é contada.
 */
/**
 * Quantas respostas compradas sobram na virada do mês.
 *
 * O plano é gasto primeiro, o pacote depois: só o que passou do plano
 * saiu do pacote. Ex.: plano 5.000, pacote 3.000, usou 6.000 → o pacote
 * pagou 1.000, sobram 2.000.
 */
export function extrasQueSobraram(conta: {
  aiMonthlyMessageLimit: number;
  aiExtraMessagesThisPeriod: number;
  aiRepliesUsed: number;
}): number {
  const gastasDoPacote = Math.max(
    0,
    conta.aiRepliesUsed - conta.aiMonthlyMessageLimit,
  );
  return Math.max(0, conta.aiExtraMessagesThisPeriod - gastasDoPacote);
}

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(private readonly prisma: TenantPrismaService) {}

  /**
   * A conta, com o período corrente já zerado se o ciclo virou.
   *
   * O ciclo é o da ASSINATURA: quem assinou dia 15 renova todo dia 15,
   * junto com a fatura. Era o dia 1º pra todo mundo, e quem assinava dia
   * 28 ganhava um mês de três dias — ou, do outro lado, pagava a fatura
   * dia 5 com as respostas do mês quase no fim.
   *
   * "Virou" é comparado a cada leitura, não numa rotina agendada — mesma
   * ideia de `historicoIniciadoEm` no canal do WhatsApp: mais simples, e
   * não depende de nenhum processo em segundo plano estar de pé.
   */
  private async linhaDoPeriodoAtual() {
    const [existente, tenant] = await Promise.all([
      this.prisma.db.billingAccount.findFirst(),
      this.prisma.db.tenant.findUnique({
        where: { id: this.prisma.tenantId },
        select: { timezone: true },
      }),
    ]);
    const conta =
      existente ??
      (await this.prisma.db.billingAccount.create({
        data: { tenantId: this.prisma.tenantId },
      }));

    const fuso = fusoValido(tenant?.timezone ?? 'America/Sao_Paulo');
    const agora = new Date();
    const dia = diaDoCiclo(conta, fuso);
    const ciclo = cicloMensal(dia, fuso, agora);
    const inicio = conta.aiUsagePeriodStart;
    const cicloVirou = !inicio || inicio.getTime() < ciclo.inicio.getTime();

    if (!cicloVirou) return { conta, ciclo, dia };

    /*
     * A virada acontece UMA vez, mesmo com várias respostas chegando juntas.
     *
     * Duas respostas no primeiro minuto do ciclo liam "virou" ao mesmo
     * tempo; a primeira zerava e contava a sua, e a segunda zerava DE NOVO
     * — a resposta da primeira sumia da conta. Com a condição no UPDATE,
     * só quem ainda vê o ciclo velho zera; o resto relê a linha nova.
     */
    await this.prisma.db.billingAccount.updateMany({
      where: {
        id: conta.id,
        OR: [
          { aiUsagePeriodStart: null },
          { aiUsagePeriodStart: { lt: ciclo.inicio } },
        ],
      },
      data: {
        aiUsagePeriodStart: agora,
        aiRepliesUsed: 0,
        aiInputTokensUsed: 0,
        aiOutputTokensUsed: 0,
        // O que foi COMPRADO e não foi usado passa pro mês seguinte; as
        // respostas do plano, não (renovam todo mês). Antes o pacote
        // zerava na virada — quem comprasse 10 mil no dia 28 perdia quase
        // tudo três dias depois, e pacote maior não teria como ser vendido
        // com honestidade.
        aiExtraMessagesThisPeriod: extrasQueSobraram(conta),
        aiCorrecoesNoPeriodo: 0,
      },
    });
    const renovada =
      (await this.prisma.db.billingAccount.findFirst({
        where: { id: conta.id },
      })) ?? conta;
    return { conta: renovada, ciclo, dia };
  }

  /** A IA desta conta ainda tem quanto sobrando no mês (plano + pacotes avulsos)? */
  async limite(): Promise<LimiteDaIa> {
    const { conta, ciclo, dia } = await this.linhaDoPeriodoAtual();
    const limite =
      conta.aiMonthlyMessageLimit + conta.aiExtraMessagesThisPeriod;
    return {
      podeResponder: conta.aiRepliesUsed < limite,
      usadas: conta.aiRepliesUsed,
      limite,
      extras: conta.aiExtraMessagesThisPeriod,
      renovaDia: dia,
      renovaEm: ciclo.fim,
    };
  }

  /**
   * Registra o custo de UMA resposta que de fato saiu.
   *
   * Só depois de a IA responder de verdade — uma chamada que falhou (erro
   * de rede, provedor fora do ar) não gastou a cota da empresa por uma
   * resposta que o cliente nunca recebeu (ver AiEngineService).
   */
  async registrar(uso: UsoDaIa): Promise<void> {
    const { conta } = await this.linhaDoPeriodoAtual();

    await this.prisma.db.billingAccount.update({
      where: { id: conta.id },
      data: {
        aiRepliesUsed: { increment: 1 },
        aiInputTokensUsed: { increment: uso.inputTokens },
        aiOutputTokensUsed: { increment: uso.outputTokens },
      },
    });

    // Log, não alarme: é o rastro que permite conferir se o custo real
    // bate com a estimativa acima, sem precisar abrir o banco.
    this.logger.log(
      `Resposta registrada (tenant ${this.prisma.tenantId}): ${uso.inputTokens} tokens de entrada, ` +
        `${uso.outputTokens} de saída, ~US$${custoEmDolar(uso.inputTokens, uso.outputTokens).toFixed(5)}.`,
    );
  }
}
