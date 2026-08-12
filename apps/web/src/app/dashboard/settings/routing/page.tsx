"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RoutingRulesCard } from "@/components/routing/routing-rules-card";
import { PageSkeleton } from "@/components/page-skeleton";
import { apiFetch } from "@/lib/api-client";
import type { Queue, RoutingRule, TeamMember } from "@/lib/types";

export default function RoutingSettingsPage() {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<RoutingRule[]>("/routing-rules"),
      apiFetch<TeamMember[]>("/users"),
      apiFetch<Queue[]>("/queues"),
    ])
      .then(([rulesResult, teamResult, queuesResult]) => {
        setRules(rulesResult);
        setTeam(teamResult);
        setQueues(queuesResult);
      })
      .catch(() => toast.error("Não deu pra carregar as regras."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageSkeleton rows={2} />;

  return <RoutingRulesCard rules={rules} team={team} queues={queues} onChange={setRules} />;
}
