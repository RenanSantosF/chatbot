"use client";

import { Bot, LibraryBig, ListTree, MessageCircle, Route, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RoutingRulesCard } from "@/components/routing/routing-rules-card";
import { WhatsAppSettingsCard } from "@/components/settings/whatsapp-settings-card";
import { PageHeader } from "@/components/page-header";
import { PageSkeleton } from "@/components/page-skeleton";
import { apiFetch } from "@/lib/api-client";
import type { Queue, RoutingRule, TeamMember, WhatsAppSettings } from "@/lib/types";

/**
 * Atalhos pras áreas que têm tela própria. Configurações é o lugar onde a
 * pessoa vem procurar "onde eu ajusto X" — mesmo o que mora em outra rota
 * precisa estar listado aqui, senão vira caça ao tesouro pelo menu.
 */
const SHORTCUTS = [
  {
    href: "/dashboard/ai",
    icon: Bot,
    title: "Inteligência artificial",
    description: "Identidade, tom de voz, chave da API, modelo, memória e ferramentas.",
  },
  {
    href: "/dashboard/knowledge",
    icon: LibraryBig,
    title: "Base de conhecimento",
    description: "Documentos que a IA consulta pra responder com precisão.",
  },
  {
    href: "/dashboard/queues",
    icon: ListTree,
    title: "Filas",
    description: "Departamentos com distribuição em rodízio entre os membros.",
  },
  {
    href: "/dashboard/team",
    icon: Users,
    title: "Equipe",
    description: "Quem tem acesso ao painel e com qual permissão.",
  },
];

export default function SettingsPage() {
  const [whatsapp, setWhatsapp] = useState<WhatsAppSettings | null>(null);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<WhatsAppSettings>("/whatsapp/settings"),
      apiFetch<RoutingRule[]>("/routing-rules"),
      apiFetch<TeamMember[]>("/users"),
      apiFetch<Queue[]>("/queues"),
    ])
      .then(([whatsappResult, rulesResult, teamResult, queuesResult]) => {
        setWhatsapp(whatsappResult);
        setRules(rulesResult);
        setTeam(teamResult);
        setQueues(queuesResult);
      })
      .catch(() => toast.error("Não deu pra carregar as configurações."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Configurações"
        description="Canais, direcionamento e integrações da sua empresa."
      />

      {loading || !whatsapp ? (
        <PageSkeleton rows={3} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="size-4" />
                Canal de atendimento
              </CardTitle>
              <CardDescription>Conexão com o WhatsApp da sua empresa.</CardDescription>
            </CardHeader>
            <CardContent>
              <WhatsAppSettingsCard settings={whatsapp} onUpdated={setWhatsapp} embedded />
            </CardContent>
          </Card>

          <RoutingRulesCard rules={rules} team={team} queues={queues} onChange={setRules} />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Route className="size-4" />
                Outras áreas
              </CardTitle>
              <CardDescription>Cada uma tem tela própria, com mais espaço pra configurar.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                {SHORTCUTS.map((shortcut) => (
                  <Link
                    key={shortcut.href}
                    href={shortcut.href}
                    className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/60"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <shortcut.icon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{shortcut.title}</p>
                      <p className="text-xs text-muted-foreground text-pretty">{shortcut.description}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
