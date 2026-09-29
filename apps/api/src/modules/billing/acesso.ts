/**
 * Dois dias entre a assinatura ficar em atraso e o acesso ser cortado.
 *
 * Curto o bastante pra não virar um mês de uso de graça, longo o
 * bastante pra dar tempo de trocar um cartão vencido sem que a empresa
 * perca atendimentos no meio do caminho — o Stripe já tenta cobrar de
 * novo automaticamente antes de chegar aqui, então quem chega neste
 * relógio é quem realmente precisa agir.
 */
export const DIAS_DE_CARENCIA = 2;
export const CARENCIA_MS = DIAS_DE_CARENCIA * 24 * 60 * 60 * 1000;

/** Por que a empresa pode (ou não) usar o sistema agora. */
export type MotivoDoAcesso =
  /** Uma pessoa da empresa é dona da plataforma (PLATFORM_ADMIN_EMAILS). */
  | 'plataforma'
  /** Dias liberados à mão pelo dono da plataforma (teste, pagou por fora, folga). */
  | 'liberado'
  /** Assinatura em dia no Stripe. */
  | 'assinatura'
  /** Pagamento falhou; ainda dentro dos dois dias. */
  | 'carencia'
  | 'bloqueado';

export interface ContaParaAcesso {
  stripeSubscriptionId: string | null;
  assinaturaVencidaEm: Date | null;
  liberadoAte?: Date | null;
}

export interface DecisaoDeAcesso {
  bloqueado: boolean;
  emCarencia: boolean;
  vencidoDesde: number | null;
  bloqueiaEm: number | null;
  liberadoAte: number | null;
  motivo: MotivoDoAcesso;
}

/**
 * A régua ÚNICA do acesso — o guard que bloqueia requisição, a tela que
 * mostra o aviso e o painel da plataforma leem daqui, e só daqui.
 *
 * A ordem é a de quem vence quem, e é o que evita briga entre a liberação
 * manual e o Stripe:
 *
 *   1. Dono da plataforma: sempre liberado.
 *   2. Liberação manual ainda valendo: liberado — com ou sem assinatura, e
 *      mesmo que o Stripe diga que o pagamento falhou. Quem liberou à mão
 *      decidiu isso sabendo; o webhook não desfaz.
 *   3. Assinatura em dia no Stripe: liberado.
 *   4. Pagamento falhou: carência de dois dias, contados de quando falhou
 *      OU de quando a liberação manual acabou — o que vier depois. Assim,
 *      quem estava liberado à mão não termina a folga já bloqueado por um
 *      atraso antigo.
 *   5. Nunca assinou (ou a liberação de teste acabou): bloqueado, sem
 *      carência — carência é prazo pra resolver cobrança, não teste grátis.
 *
 * Função pura: nenhuma consulta aqui dentro, pra o mesmo cálculo valer
 * em todo lugar e poder ser testado sem banco.
 */
export function decidirAcesso(
  conta: ContaParaAcesso | null | undefined,
  {
    daPlataforma = false,
    agora = Date.now(),
  }: { daPlataforma?: boolean; agora?: number } = {},
): DecisaoDeAcesso {
  const liberadoAte = conta?.liberadoAte?.getTime() ?? null;
  const livre = (motivo: MotivoDoAcesso): DecisaoDeAcesso => ({
    bloqueado: false,
    emCarencia: false,
    vencidoDesde: null,
    bloqueiaEm: null,
    liberadoAte,
    motivo,
  });

  if (daPlataforma) return livre('plataforma');
  if (liberadoAte !== null && liberadoAte > agora) return livre('liberado');
  if (conta?.stripeSubscriptionId) return livre('assinatura');

  if (conta?.assinaturaVencidaEm) {
    const vencida = conta.assinaturaVencidaEm.getTime();
    const bloqueiaEm = Math.max(vencida, liberadoAte ?? 0) + CARENCIA_MS;
    const bloqueado = agora >= bloqueiaEm;
    return {
      bloqueado,
      emCarencia: !bloqueado,
      vencidoDesde: vencida,
      bloqueiaEm,
      liberadoAte,
      motivo: bloqueado ? 'bloqueado' : 'carencia',
    };
  }

  return {
    bloqueado: true,
    emCarencia: false,
    vencidoDesde: null,
    bloqueiaEm: null,
    liberadoAte,
    motivo: 'bloqueado',
  };
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Até quando fica a liberação depois de somar `dias`.
 *
 * Soma ao que ainda falta, e não a partir de hoje: liberar mais 7 dias pra
 * quem ainda tem 3 dá 10, não 7 — "acrescentar dias" é acrescentar.
 */
export function novaLiberacao(
  atual: Date | null | undefined,
  dias: number,
  agora = Date.now(),
) {
  const base = Math.max(agora, atual?.getTime() ?? 0);
  return new Date(base + dias * DIA_MS);
}

/**
 * A nova data da próxima cobrança no Stripe, adiada em `dias`.
 *
 * Parte do que JÁ estava pago (fim do período, ou fim de um adiamento
 * anterior), e não de hoje. Partir de hoje faria o cliente perder o resto
 * do mês que ele pagou: quem pagou dia 1 e ganhou 5 dias de folga no dia
 * 10 seria cobrado dia 15, em vez de no dia 5 do mês seguinte.
 */
export function proximaCobrancaAdiada(
  assinatura: { trialEnd: number | null; fimDoPeriodo: number | null },
  dias: number,
  agora = Date.now(),
): Date {
  const base = Math.max(
    agora,
    (assinatura.trialEnd ?? 0) * 1000,
    (assinatura.fimDoPeriodo ?? 0) * 1000,
  );
  return new Date(base + dias * DIA_MS);
}
