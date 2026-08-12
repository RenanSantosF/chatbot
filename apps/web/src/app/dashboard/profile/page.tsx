"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { TeamMember, UserRole } from "@/lib/types";

const ROLE_LABEL: Record<UserRole, string> = {
  OWNER: "Dono",
  ADMIN: "Admin",
  AGENT: "Atendente",
};

const ROLE_ABILITIES: Record<UserRole, string[]> = {
  OWNER: [
    "Tudo do Admin",
    "Adicionar e remover colaboradores",
    "Definir a permissão de cada pessoa",
  ],
  ADMIN: [
    "Atender no Inbox e ver clientes",
    "Configurar a IA, o conhecimento e as filas",
    "Conectar o WhatsApp da empresa",
  ],
  AGENT: ["Atender no Inbox", "Ver a lista de clientes e o histórico"],
};

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<TeamMember | null>(null);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    apiFetch<TeamMember>("/users/me")
      .then((result) => {
        setProfile(result);
        setName(result.name);
      })
      .catch(() => toast.error("Não deu pra carregar seu perfil."));
  }, []);

  async function handleSaveName(event: React.FormEvent) {
    event.preventDefault();
    setSavingName(true);
    try {
      const updated = await apiFetch<TeamMember>("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setProfile(updated);
      toast.success("Perfil atualizado.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Não deu pra salvar.");
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("A confirmação não bate com a nova senha.");
      return;
    }
    setSavingPassword(true);
    try {
      await apiFetch<TeamMember>("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Senha alterada.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Não deu pra trocar a senha.");
    } finally {
      setSavingPassword(false);
    }
  }

  if (!profile) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Meu perfil" description="Seus dados de acesso." />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Meu perfil" description="Seus dados de acesso a esta empresa." />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Avatar className="size-12 shrink-0">
              <AvatarFallback className="text-base">{initials(profile.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <CardTitle className="truncate">{profile.name}</CardTitle>
              <CardDescription className="truncate">{profile.email}</CardDescription>
            </div>
            <Badge variant="secondary" className="ml-auto shrink-0">
              {ROLE_LABEL[profile.role]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveName} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-name" className="text-xs">
                Nome
              </Label>
              <Input
                id="profile-name"
                className="w-64"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                minLength={2}
              />
            </div>
            <Button type="submit" disabled={savingName || name.trim() === profile.name || name.trim().length < 2}>
              {savingName ? <Spinner /> : null}
              Salvar
            </Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            O e-mail e a permissão não são editáveis por aqui — quem muda isso é o dono da empresa, na tela
            de Equipe.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            Trocar senha
          </CardTitle>
          <CardDescription>Pedimos a senha atual pra confirmar que é você mesmo.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="current-password" className="text-xs">
                Senha atual
              </Label>
              <Input
                id="current-password"
                type="password"
                className="w-52"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-password" className="text-xs">
                Nova senha
              </Label>
              <Input
                id="new-password"
                type="password"
                className="w-52"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-password" className="text-xs">
                Repetir a nova
              </Label>
              <Input
                id="confirm-password"
                type="password"
                className="w-52"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                minLength={8}
              />
            </div>
            <Button
              type="submit"
              disabled={savingPassword || !currentPassword || newPassword.length < 8 || !confirmPassword}
            >
              {savingPassword ? <Spinner /> : null}
              Trocar senha
            </Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">Mínimo de 8 caracteres.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            O que você pode fazer
          </CardTitle>
          <CardDescription>Permissões do seu perfil de {ROLE_LABEL[profile.role]}.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1.5 text-sm">
            {ROLE_ABILITIES[profile.role].map((ability) => (
              <li key={ability} className="flex items-center gap-2">
                <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                {ability}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
