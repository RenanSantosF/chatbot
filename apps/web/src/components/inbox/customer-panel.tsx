import { Badge } from "@/components/ui/badge";
import type { AiMode, ConversationDetail, ConversationPriority, ConversationStatus } from "@/lib/types";

const STATUS_LABEL: Record<ConversationStatus, string> = {
  OPEN: "Aberta",
  WAITING_CUSTOMER: "Aguardando cliente",
  WAITING_AGENT: "Aguardando atendente",
  RESOLVED: "Resolvida",
  CLOSED: "Fechada",
};

const AI_MODE_LABEL: Record<AiMode, string> = {
  AI_ACTIVE: "IA respondendo",
  HUMAN_ACTIVE: "Com atendente",
  AI_ASSIST: "IA sugerindo",
  PAUSED: "Pausada",
};

const PRIORITY_LABEL: Record<ConversationPriority, string> = {
  LOW: "Baixa",
  NORMAL: "Normal",
  HIGH: "Alta",
  URGENT: "Urgente",
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function CustomerPanel({ conversation }: { conversation: ConversationDetail | null }) {
  if (!conversation) {
    return <div className="p-4 text-sm text-muted-foreground">Nenhuma conversa selecionada.</div>;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Cliente
        </h3>
        <InfoRow label="Nome" value={conversation.customer.name} />
        <InfoRow label="Telefone" value={conversation.customer.phone} />
        {conversation.customer.email ? <InfoRow label="E-mail" value={conversation.customer.email} /> : null}
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Atendimento
        </h3>
        <InfoRow label="Status" value={STATUS_LABEL[conversation.status]} />
        <InfoRow label="IA" value={AI_MODE_LABEL[conversation.aiMode]} />
        <InfoRow label="Prioridade" value={PRIORITY_LABEL[conversation.priority]} />
        <InfoRow label="Responsável" value={conversation.assignedUser?.name ?? "Ninguém"} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">{conversation.messages.length} mensagens</Badge>
      </div>
    </div>
  );
}
