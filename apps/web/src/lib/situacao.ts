import type { ConversationSummary } from "@/lib/types";

export type TomDaSituacao = "ia" | "pessoa" | "fila" | "fim";

export interface Situacao {
  /** A frase curta: "Com a IA", "Com Renan", "Esperando alguém assumir"... */
  rotulo: string;
  tom: TomDaSituacao;
  /** Uma linha de apoio, quando ajuda a decidir o que fazer. */
  detalhe?: string;
}

/**
 * Em que pé está o atendimento, numa linha só.
 *
 * A ficha mostrava "IA: Com atendente" e "Responsável: Renan" em linhas
 * separadas, e as duas juntas não respondiam a pergunta de quem abre a
 * conversa: quem está cuidando disto agora? Aqui é uma resposta só, na
 * ordem em que as coisas valem — encerrado vence tudo; depois, uma pessoa
 * com a conversa na mão; depois, alguém indicado que ainda não aceitou; a
 * IA respondendo; e, sobrando, a conversa parada esperando alguém pegar.
 */
export function situacaoDoAtendimento(
  conversa: Pick<
    ConversationSummary,
    "status" | "aiMode" | "assignedUser" | "assignmentAccepted" | "queue"
  >,
): Situacao {
  if (conversa.status === "RESOLVED" || conversa.status === "CLOSED") {
    return { rotulo: "Finalizado", tom: "fim" };
  }

  const pessoa = conversa.assignedUser?.name?.split(" ")[0];
  if (pessoa && conversa.assignmentAccepted) {
    return { rotulo: `Com ${pessoa}`, tom: "pessoa" };
  }
  if (pessoa) {
    return {
      rotulo: `Esperando ${pessoa} aceitar`,
      tom: "fila",
      detalhe: "Foi indicado, mas ainda não assumiu.",
    };
  }

  if (conversa.aiMode === "AI_ACTIVE") {
    return { rotulo: "Com a IA", tom: "ia" };
  }

  return {
    rotulo: "Esperando alguém assumir",
    tom: "fila",
    detalhe: conversa.queue ? `Na fila de ${conversa.queue.name}.` : undefined,
  };
}

/** A cor do ponto de cada situação. */
export const COR_DA_SITUACAO: Record<TomDaSituacao, string> = {
  ia: "bg-sky-500",
  pessoa: "bg-primary",
  fila: "bg-amber-500",
  fim: "bg-muted-foreground/50",
};
