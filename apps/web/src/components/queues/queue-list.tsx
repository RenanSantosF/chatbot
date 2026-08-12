"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { Queue, TeamMember } from "@/lib/types";

export function QueueList({
  queues,
  teamMembers,
  onChange,
}: {
  queues: Queue[];
  teamMembers: TeamMember[];
  onChange: (queues: Queue[]) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  function replaceQueue(updated: Queue) {
    onChange(queues.map((queue) => (queue.id === updated.id ? updated : queue)));
  }

  async function handleAddMember(queueId: string, userId: string) {
    setBusy(`${queueId}:${userId}`);
    try {
      const updated = await apiFetch<Queue>(`/queues/${queueId}/members/${userId}`, { method: "POST" });
      replaceQueue(updated);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Não deu pra adicionar o membro.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRemoveMember(queueId: string, userId: string) {
    setBusy(`${queueId}:${userId}`);
    try {
      const updated = await apiFetch<Queue>(`/queues/${queueId}/members/${userId}`, { method: "DELETE" });
      replaceQueue(updated);
    } catch {
      toast.error("Não deu pra remover o membro.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteQueue(queueId: string) {
    setBusy(queueId);
    try {
      await apiFetch(`/queues/${queueId}`, { method: "DELETE" });
      onChange(queues.filter((queue) => queue.id !== queueId));
    } catch {
      toast.error("Não deu pra excluir a fila.");
      setBusy(null);
    }
  }

  if (queues.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma fila criada ainda.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {queues.map((queue) => {
        const memberIds = new Set(queue.members.map((member) => member.userId));
        const available = teamMembers.filter((member) => !memberIds.has(member.id));

        return (
          <Card key={queue.id}>
            <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle>{queue.name}</CardTitle>
                {queue.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{queue.description}</p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy === queue.id}
                onClick={() => handleDeleteQueue(queue.id)}
              >
                Excluir
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div>
                <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Membros
                </h4>
                {queue.members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ninguém nesta fila ainda.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {queue.members.map((member) => (
                      <Badge key={member.id} variant="secondary" className="gap-1.5 pr-1">
                        {member.user.name}
                        <button
                          type="button"
                          disabled={busy === `${queue.id}:${member.userId}`}
                          onClick={() => handleRemoveMember(queue.id, member.userId)}
                          className="rounded-full px-1 text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
                          aria-label={`Remover ${member.user.name} da fila`}
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {available.length > 0 ? (
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Adicionar
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {available.map((member) => (
                      <Button
                        key={member.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={busy === `${queue.id}:${member.id}`}
                        onClick={() => handleAddMember(queue.id, member.id)}
                      >
                        + {member.name}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
