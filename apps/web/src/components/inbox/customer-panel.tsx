import { UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import type { AiMode, ConversationDetail, ConversationPriority, ConversationStatus } from "@/lib/types";
import { TasksSection } from "./tasks-section";

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
    return (
      <div className="p-4">
        <EmptyState
          icon={UserRound}
          title="Sem conversa aberta"
          description="Os dados do cliente aparecem aqui quando você abre uma conversa."
        />
      </div>
    );
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
        {conversation.queue ? <InfoRow label="Fila" value={conversation.queue.name} /> : null}
      </div>

      {conversation.escalationSummary || conversation.escalationReason ? (
        <div>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Escalonamento
          </h3>
          {conversation.escalationReason ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Motivo: </span>
              {conversation.escalationReason}
            </p>
          ) : null}
          {conversation.escalationSummary ? (
            <p className="mt-1 text-sm">
              <span className="text-muted-foreground">Resumo: </span>
              {conversation.escalationSummary}
            </p>
          ) : null}
        </div>
      ) : null}

      {conversation.customer.metadata && Object.keys(conversation.customer.metadata).length > 0 ? (
        <div>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            O que a IA lembra
          </h3>
          {Object.entries(conversation.customer.metadata).map(([key, value]) => (
            <InfoRow key={key} label={key} value={String(value)} />
          ))}
        </div>
      ) : null}

      {conversation.collectedData && Object.keys(conversation.collectedData).length > 0 ? (
        <div>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Dados coletados
          </h3>
          {Object.entries(conversation.collectedData).map(([key, value]) => (
            <InfoRow key={key} label={key} value={value} />
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">
          {conversation.messages.length}{" "}
          {conversation.messages.length === 1 ? "mensagem" : "mensagens"}
        </Badge>
      </div>

      <TasksSection key={conversation.id} conversationId={conversation.id} />
    </div>
  );
}
