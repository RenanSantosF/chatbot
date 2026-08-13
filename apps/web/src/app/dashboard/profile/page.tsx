"use client";

import { KeyRound, Network, Pencil, ShieldCheck } from "lucide-react";
import Link from "next/link";
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
import type { Queue, TeamMember, UserRole } from "@/lib/types";

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
  const [editingName, setEditingName] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [meusSetores, setMeusSetores] = useState<Queue[] | null>(null);

  useEffect(() => {
    apiFetch<TeamMember>("/users/me")
      .then((result) => {
        setProfile(result);
        setName(result.name);
        // Os setores vêm da lista de filas com seus membros — não existe
        // rota "minhas filas", e criar uma só pra isto seria mais código
        // pra manter do que um filtro aqui.
        return apiFetch<Queue[]>("/queues")
          .then((filas) =>
            setMeusSetores(
              filas.filter((f) => f.members.some((m) => m.userId === result.id)),
            ),
          )
          .catch(() => setMeusSetores([]));
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
      setEditingName(false);
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
      setEditingPassword(false);
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
          {editingName ? (
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
                  autoFocus
                />
              </div>
              <Button
                type="submit"
                disabled={savingName || name.trim() === profile.name || name.trim().length < 2}
              >
                {savingName ? <Spinner /> : null}
                Salvar
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setName(profile.name);
                  setEditingName(false);
                }}
              >
                Cancelar
              </Button>
            </form>
          ) : (
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Nome</p>
                <p className="truncate text-sm font-medium">{profile.name}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditingName(true)}>
                <Pencil className="size-3.5" />
                Editar
              </Button>
            </div>
          )}
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
          {!editingPassword ? (
            <Button size="sm" variant="outline" onClick={() => setEditingPassword(true)}>
              <Pencil className="size-3.5" />
              Trocar senha
            </Button>
          ) : (
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCurrentPassword("");
                setNewPassword("");
                setConfirmPassword("");
                setEditingPassword(false);
              }}
            >
              Cancelar
            </Button>
          </form>
          )}
          {editingPassword ? (
            <p className="mt-3 text-xs text-muted-foreground">Mínimo de 8 caracteres.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="size-4" />
            Seus setores
          </CardTitle>
          <CardDescription>
            Setores de que você participa. Conversa encaminhada pra um deles aparece pra você
            assumir.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {meusSetores === null ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : meusSetores.length === 0 ? (
            <p className="text-sm text-muted-foreground text-pretty">
              Você ainda não está em nenhum setor.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {meusSetores.map((setor) => (
                <span
                  key={setor.id}
                  className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium"
                >
                  {setor.name}
                </span>
              ))}
            </div>
          )}
          {/* Sair de um setor mudaria o que você enxerga quando a empresa
              restringe visibilidade por setor — então quem mexe nisso é
              quem administra, não a própria pessoa. */}
          {profile.role === "OWNER" || profile.role === "ADMIN" ? (
            <Link
              href="/dashboard/settings/queues"
              className="text-xs font-medium underline underline-offset-4"
            >
              Gerenciar setores e participantes
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">
              Pra entrar ou sair de um setor, fale com quem administra a conta.
            </p>
          )}
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
