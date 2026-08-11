import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/api-error";
import { apiFetchServer } from "@/lib/api-server";
import type { TeamMember } from "@/lib/types";

const ROLE_LABEL: Record<TeamMember["role"], string> = {
  OWNER: "Dono",
  ADMIN: "Admin",
  AGENT: "Atendente",
};

export default async function TeamPage() {
  let team: TeamMember[] = [];
  let errorMessage: string | null = null;

  try {
    team = (await apiFetchServer<TeamMember[]>("/users")) ?? [];
  } catch (err) {
    errorMessage =
      err instanceof ApiError
        ? err.message
        : "Não deu pra carregar a equipe agora.";
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Equipe</h1>
        <p className="text-muted-foreground">Quem tem acesso ao painel desta empresa.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usuários</CardTitle>
          <CardDescription>Convite e gestão completa da equipe chegam na próxima fase.</CardDescription>
        </CardHeader>
        <CardContent>
          {errorMessage ? (
            <p className="text-sm text-destructive">{errorMessage}</p>
          ) : (
            <div className="flex flex-col divide-y">
              {team.map((member) => (
                <div key={member.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">{member.name}</p>
                    <p className="text-sm text-muted-foreground">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{ROLE_LABEL[member.role]}</Badge>
                    <Badge variant={member.status === "ACTIVE" ? "default" : "outline"}>
                      {member.status === "ACTIVE" ? "Ativo" : member.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
