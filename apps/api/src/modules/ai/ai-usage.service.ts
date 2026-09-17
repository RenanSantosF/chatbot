import { Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { custoEmDolar } from './preco-do-modelo';

export interface UsoDaIa {
  inputTokens: number;
  outputTokens: number;
}

export interface LimiteDaIa {
  podeResponder: boolean;
  usadas: number;
  limite: number;
}

/**
 * Quantas respostas da IA a conta já gastou este mês, e se ainda pode
 * gastar mais.
 *
 * O PORQUÊ DO LIMITE: a chave de IA agora é da plataforma (ver
 * AiCredentialsResolver) — quem paga o provedor por cada resposta é a
 * Inteliwa, não mais a empresa. Sem um teto, uma conta com um bug de loop
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
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(private readonly prisma: TenantPrismaService) {}

  /**
   * A conta, com o período corrente já zerado se o mês virou.
   *
   * "Virou o mês" é comparado a cada leitura, não numa rotina agendada —
   * mesma ideia de `historicoIniciadoEm` no canal do WhatsApp: mais
   * simples, e não depende de nenhum processo em segundo plano estar de
   * pé pra funcionar.
   */
  private async linhaDoPeriodoAtual() {
    const existente = await this.prisma.db.billingAccount.findFirst();
    const conta =
      existente ??
      (await this.prisma.db.billingAccount.create({
        data: { tenantId: this.prisma.tenantId },
      }));

    const inicio = conta.aiUsagePeriodStart;
    const agora = new Date();
    const mesVirou =
      !inicio ||
      inicio.getUTCFullYear() !== agora.getUTCFullYear() ||
      inicio.getUTCMonth() !== agora.getUTCMonth();

    if (!mesVirou) return conta;

    return this.prisma.db.billingAccount.update({
      where: { id: conta.id },
      data: {
        aiUsagePeriodStart: agora,
        aiRepliesUsed: 0,
        aiInputTokensUsed: 0,
        aiOutputTokensUsed: 0,
      },
    });
  }

  /** A IA desta conta ainda tem quanto sobrando no mês? */
  async limite(): Promise<LimiteDaIa> {
    const conta = await this.linhaDoPeriodoAtual();
    return {
      podeResponder: conta.aiRepliesUsed < conta.aiMonthlyMessageLimit,
      usadas: conta.aiRepliesUsed,
      limite: conta.aiMonthlyMessageLimit,
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
    const conta = await this.linhaDoPeriodoAtual();

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
