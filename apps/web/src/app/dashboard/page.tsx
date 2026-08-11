import { Bot, Building2, Inbox } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetchServer } from "@/lib/api-server";
import type { MeResponse } from "@/lib/types";

export default async function DashboardOverviewPage() {
  const session = await apiFetchServer<MeResponse>("/auth/me");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Olá, {session?.user.name.split(" ")[0]}
        </h1>
        <p className="text-muted-foreground">
          {session?.tenant.name} está com a Fase 1 (autenticação e multi-tenant) no ar.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Conversas</CardTitle>
            <Inbox className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">0</div>
            <CardDescription>Chega na Fase 2</CardDescription>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Resolvidas pela IA
            </CardTitle>
            <Bot className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">—</div>
            <CardDescription>Chega na Fase 3</CardDescription>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Equipe
            </CardTitle>
            <Building2 className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{session?.user.role}</div>
            <CardDescription>Veja em &ldquo;Equipe&rdquo;</CardDescription>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
