"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateMemberCard } from "@/components/team/create-member-card";
import { TeamMemberRow } from "@/components/team/team-member-row";
import { apiFetch } from "@/lib/api-client";
import type { MeResponse, TeamMember } from "@/lib/types";

export default function TeamPage() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([apiFetch<TeamMember[]>("/users"), apiFetch<MeResponse>("/auth/me")])
      .then(([teamResult, me]) => {
        setTeam(teamResult);
        setCurrentUserId(me.user.id);
      })
      .catch(() => toast.error("Não deu pra carregar a equipe agora."))
      .finally(() => setLoading(false));
  }, []);

  function handleUpdated(updated: TeamMember) {
    setTeam((prev) => prev.map((member) => (member.id === updated.id ? updated : member)));
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Equipe</h1>
        <p className="text-muted-foreground">Quem tem acesso ao painel desta empresa.</p>
      </div>

      {loading || !currentUserId ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <>
          <CreateMemberCard onCreated={(member) => setTeam((prev) => [...prev, member])} />

          <Card>
            <CardHeader>
              <CardTitle>Usuários</CardTitle>
              <CardDescription>
                Admin tem acesso completo (configurações, IA, filas); Atendente só vê o Inbox e os clientes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col divide-y">
                {team.map((member) => (
                  <TeamMemberRow
                    key={member.id}
                    member={member}
                    currentUserId={currentUserId}
                    onUpdated={handleUpdated}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
