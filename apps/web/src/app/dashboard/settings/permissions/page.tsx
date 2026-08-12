"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { PageSkeleton } from "@/components/page-skeleton";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { MeResponse, PermissionMatrix } from "@/lib/types";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  AGENT: "Atendente",
};

export default function PermissionsPage() {
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiFetch<PermissionMatrix>("/permissions"), apiFetch<MeResponse>("/auth/me")])
      .then(([matrixResult, me]) => {
        setMatrix(matrixResult);
        setIsOwner(me.user.role === "OWNER");
      })
      .catch(() => toast.error("Não deu pra carregar as permissões."));
  }, []);

  async function handleToggle(role: string, key: string, allowed: boolean) {
    const marker = `${role}:${key}`;
    setSaving(marker);
    try {
      const updated = await apiFetch<PermissionMatrix>("/permissions", {
        method: "PUT",
        body: JSON.stringify({ role, key, allowed }),
      });
      setMatrix(updated);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Não deu pra salvar.");
    } finally {
      setSaving(null);
    }
  }

  if (!matrix) return <PageSkeleton rows={3} />;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Permissões por perfil</CardTitle>
          <CardDescription>
            {isOwner
              ? "Escolha o que cada perfil pode fazer. O dono sempre tem acesso a tudo e não aparece aqui."
              : "Só o dono da empresa altera estas permissões. Abaixo, o que vale hoje."}
          </CardDescription>
        </CardHeader>
      </Card>

      {matrix.catalog.map((group) => (
        <Card key={group.group}>
          <CardHeader>
            <CardTitle className="text-sm">{group.group}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="py-2 text-left font-medium text-muted-foreground">
                      Ação
                    </th>
                    {matrix.roles.map((entry) => (
                      <th
                        key={entry.role}
                        scope="col"
                        className="w-24 py-2 text-center font-medium text-muted-foreground"
                      >
                        {ROLE_LABEL[entry.role] ?? entry.role}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {group.items.map((item) => (
                    <tr key={item.key}>
                      <td className="py-2.5 pr-3">{item.label}</td>
                      {matrix.roles.map((entry) => {
                        const marker = `${entry.role}:${item.key}`;
                        return (
                          <td key={entry.role} className="py-2.5 text-center">
                            <Switch
                              checked={entry.permissions[item.key] ?? false}
                              disabled={!isOwner || saving === marker}
                              aria-label={`${item.label} para ${ROLE_LABEL[entry.role] ?? entry.role}`}
                              onCheckedChange={(checked) =>
                                handleToggle(entry.role, item.key, checked)
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
