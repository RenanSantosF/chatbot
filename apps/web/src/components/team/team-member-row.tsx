"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { TeamMember } from "@/lib/types";

const ROLE_LABEL: Record<TeamMember["role"], string> = {
  OWNER: "Dono",
  ADMIN: "Admin",
  AGENT: "Atendente",
};

export function TeamMemberRow({
  member,
  currentUserId,
  onUpdated,
}: {
  member: TeamMember;
  currentUserId: string;
  onUpdated: (member: TeamMember) => void;
}) {
  const [updating, setUpdating] = useState(false);
  const isSelf = member.id === currentUserId;
  const canManage = !isSelf && member.role !== "OWNER";

  async function updateMember(data: { role?: "ADMIN" | "AGENT"; status?: "ACTIVE" | "DISABLED" }) {
    setUpdating(true);
    try {
      const updated = await apiFetch<TeamMember>(`/users/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      onUpdated(updated);
    } catch {
      toast.error("Não deu pra atualizar esse colaborador.");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <p className="text-sm font-medium">
          {member.name} {isSelf ? <span className="text-muted-foreground">(você)</span> : null}
        </p>
        <p className="text-sm text-muted-foreground">{member.email}</p>
      </div>
      <div className="flex items-center gap-2">
        {canManage ? (
          <div className="flex gap-1">
            {(["ADMIN", "AGENT"] as const).map((role) => (
              <button
                key={role}
                type="button"
                disabled={updating}
                onClick={() => updateMember({ role })}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  member.role === role
                    ? "border-primary bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {ROLE_LABEL[role]}
              </button>
            ))}
          </div>
        ) : (
          <Badge variant="secondary">{ROLE_LABEL[member.role]}</Badge>
        )}
        <Badge variant={member.status === "ACTIVE" ? "default" : "outline"}>
          {member.status === "ACTIVE" ? "Ativo" : member.status === "DISABLED" ? "Desativado" : member.status}
        </Badge>
        {canManage ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={updating}
            className={member.status === "ACTIVE" ? "text-destructive" : ""}
            onClick={() => updateMember({ status: member.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}
          >
            {member.status === "ACTIVE" ? "Desativar" : "Ativar"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
