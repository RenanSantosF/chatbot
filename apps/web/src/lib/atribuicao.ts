import type { ConversationSummary } from "@/lib/types";

/**
 * Quem é o responsável — e se ele já sabe disso.
 *
 * O sistema tem dois estados que a tela tratava como um só. Quando uma
 * regra de direcionamento (ou a IA por ela) escolhe uma pessoa, a conversa
 * fica com `assignedUserId` preenchido e `assignmentAccepted: false`: é uma
 * INDICAÇÃO, esperando a pessoa confirmar. O painel mostrava
 * "Responsável: Lucas" nos dois casos.
 *
 * A diferença não é sutil pra quem está olhando a tela. "Responsável:
 * Lucas" significa que o atendimento tem dono e alguém está cuidando —
 * então ninguém mais mexe. Enquanto o aceite não vem, não há dono nenhum: a
 * conversa está parada esperando um clique que pode nunca acontecer,
 * porque o Lucas saiu, está em reunião ou nem viu. Foi exatamente o que o
 * print mostrou — uma conversa recém-encaminhada aparecendo como resolvida
 * de responsabilidade.
 */
export interface Responsavel {
  /** O rótulo do campo: muda com o estado, e é ele que evita a leitura errada. */
  rotulo: string;
  nome: string;
  /** Indicado e ainda sem confirmação. */
  aguardandoAceite: boolean;
}

export function descreverResponsavel(
  conversation: Pick<ConversationSummary, "assignedUser" | "assignmentAccepted">,
): Responsavel {
  const nome = conversation.assignedUser?.name;

  if (!nome) {
    return { rotulo: "Responsável", nome: "Ninguém ainda", aguardandoAceite: false };
  }

  if (conversation.assignmentAccepted) {
    return { rotulo: "Responsável", nome, aguardandoAceite: false };
  }

  return { rotulo: "Indicado", nome, aguardandoAceite: true };
}
