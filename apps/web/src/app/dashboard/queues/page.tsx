"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CreateQueueCard } from "@/components/queues/create-queue-card";
import { QueueList } from "@/components/queues/queue-list";
import { PageHeader } from "@/components/page-header";
import { PageSkeleton } from "@/components/page-skeleton";
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
      <PageHeader
        title="Filas"
        description="Departamentos pra onde a IA pode transferir atendimentos, com distribuição em rodízio entre os membros."
      />

      {loading ? (
        <PageSkeleton rows={3} />
      ) : (
        <>
          <CreateQueueCard onCreated={(queue) => setQueues((prev) => [...prev, queue])} />
          <QueueList queues={queues} teamMembers={teamMembers} onChange={setQueues} />
        </>
      )}
    </div>
  );
}
