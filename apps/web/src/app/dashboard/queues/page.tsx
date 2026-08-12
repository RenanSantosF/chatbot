"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CreateQueueCard } from "@/components/queues/create-queue-card";
import { QueueList } from "@/components/queues/queue-list";
import { apiFetch } from "@/lib/api-client";
import type { Queue, TeamMember } from "@/lib/types";

export default function QueuesPage() {
  const [queues, setQueues] = useState<Queue[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [queuesResult, teamResult] = await Promise.all([
          apiFetch<Queue[]>("/queues"),
          apiFetch<TeamMember[]>("/users"),
        ]);
        setQueues(queuesResult);
        setTeamMembers(teamResult);
      } catch {
        toast.error("Não deu pra carregar as filas.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Filas</h1>
        <p className="text-muted-foreground">
          Departamentos pra onde a IA pode transferir atendimentos, com distribuição em rodízio entre os
          membros.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <>
          <CreateQueueCard onCreated={(queue) => setQueues((prev) => [...prev, queue])} />
          <QueueList queues={queues} teamMembers={teamMembers} onChange={setQueues} />
        </>
      )}
    </div>
  );
}
