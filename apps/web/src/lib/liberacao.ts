import type { EstadoDaCobranca } from "@/lib/types";

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

/** A partir de quando o aviso aparece: os três últimos dias da liberação. */
export const AVISAR_COM_ANTECEDENCIA_MS = 3 * DIA;

/**
 * Até quando o Checkout ainda consegue agendar a primeira cobrança pro fim
 * da liberação. O Stripe exige 48 h de antecedência; a API usa 49 h de
 * folga (ver criarCheckout), e aqui vale a mesma conta, pra a frase não
 * prometer "só cobra no fim" quando a cobrança vai ser na hora.
 */
const MINIMO_PRA_AGENDAR_MS = 49 * HORA;

export interface AvisoDeFimDaLiberacao {
  /** Epoch ms — quando os dias liberados acabam. */
  ate: number;
  /** Quanto falta, em ms. */
  restante: number;
  /** Menos de um dia: o aviso muda de tom. */
  urgente: boolean;
  /** Assinar agora ainda deixa a primeira cobrança pro fim da liberação. */
  cobrancaNoFim: boolean;
}

/**
 * Se a empresa deve ver o aviso de que os dias liberados estão acabando.
 *
 * Só pra quem está usando por liberação E não tem assinatura: é quem vai
 * ser bloqueado quando os dias acabarem. Quem assina continua sendo
 * cobrado normalmente pelo Stripe (a liberação ali é folga), e avisar
 * "vai acabar" pra essa pessoa só assustaria.
 */
export function avisoDeFimDaLiberacao(
  cobranca: EstadoDaCobranca,
  agora = Date.now(),
): AvisoDeFimDaLiberacao | null {
  if (cobranca.motivo !== "liberado" || cobranca.assinaturaAtiva) return null;
  if (!cobranca.liberadoAte) return null;
  const restante = cobranca.liberadoAte - agora;
  if (restante <= 0 || restante > AVISAR_COM_ANTECEDENCIA_MS) return null;
  return {
    ate: cobranca.liberadoAte,
    restante,
    urgente: restante < DIA,
    cobrancaNoFim: restante >= MINIMO_PRA_AGENDAR_MS,
  };
}
