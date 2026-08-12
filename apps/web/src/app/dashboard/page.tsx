import { Bot, Inbox, ListTree, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetchServer } from "@/lib/api-server";
import type { ConversationSummary, MeResponse, Queue, TeamMember } from "@/lib/types";

const OPEN_STATUSES = new Set(["OPEN", "WAITING_CUSTOMER", "WAITING_AGENT"]);

export default async function DashboardOverviewPage() {
  const [session, conversations, team, queues] = await Promise.all([
    apiFetchServer<MeResponse>("/auth/me"),
    apiFetchServer<ConversationSummary[]>("/conversations").catch(() => []),
    apiFetchServer<TeamMember[]>("/users").catch(() => []),
    apiFetchServer<Queue[]>("/queues").catch(() => []),
  ]);

  const conversationList = conversations ?? [];
  const openCount = conversationList.filter((c) => OPEN_STATUSES.has(c.status)).length;
  const resolvedByAiCount = conversationList.filter(
    (c) => (c.status === "RESOLVED" || c.status === "CLOSED") && !c.assignedUser,
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Olá, {session?.user.name.split(" ")[0]}</h1>
        <p className="text-muted-foreground">Visão geral do atendimento de {session?.tenant.name}.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Conversas em aberto</CardTitle>
            <Inbox className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{openCount}</div>
            <CardDescription>{conversationList.length} no total</CardDescription>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Resolvidas só pela IA</CardTitle>
            <Bot className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{resolvedByAiCount}</div>
            <CardDescription>Sem precisar de atendente</CardDescription>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Filas</CardTitle>
            <ListTree className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{queues?.length ?? 0}</div>
            <CardDescription>Veja em &ldquo;Filas&rdquo;</CardDescription>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Equipe</CardTitle>
            <Users className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{team?.length ?? 0}</div>
            <CardDescription>Veja em &ldquo;Equipe&rdquo;</CardDescription>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
