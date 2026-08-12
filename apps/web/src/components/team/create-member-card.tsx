"use client";

import { UserPlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import type { TeamMember } from "@/lib/types";

type NewUserRole = "ADMIN" | "AGENT";

const ROLE_OPTIONS: { value: NewUserRole; label: string; description: string }[] = [
  { value: "ADMIN", label: "Admin", description: "Acesso completo: configurações, IA, filas, equipe." },
  { value: "AGENT", label: "Atendente", description: "Só o Inbox e os clientes — sem acesso a configurações." },
];

export function CreateMemberCard({ onCreated }: { onCreated: (member: TeamMember) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<NewUserRole>("AGENT");
  const [creating, setCreating] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setCreating(true);
    try {
      const result = await apiFetch<{ user: TeamMember; temporaryPassword: string }>("/users", {
        method: "POST",
        body: JSON.stringify({ name, email, role }),
      });
      onCreated(result.user);
      setCreatedPassword({ email: result.user.email, password: result.temporaryPassword });
      setName("");
      setEmail("");
      setRole("AGENT");
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não deu pra criar o colaborador.");
    } finally {
      setCreating(false);
    }
  }

  if (createdPassword) {
    return (
      <Card className="border-primary/40 bg-primary/5">
        <CardHeader>
          <CardTitle>Colaborador criado</CardTitle>
          <CardDescription>
            Essa senha só aparece agora — copie e repasse pro colaborador (WhatsApp, verbalmente, etc). Ele
            deve trocar depois de entrar.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 rounded-md border bg-background p-3 text-sm">
            <p>
              <span className="text-muted-foreground">E-mail: </span>
              {createdPassword.email}
            </p>
            <p>
              <span className="text-muted-foreground">Senha temporária: </span>
              <span className="font-mono font-medium">{createdPassword.password}</span>
            </p>
          </div>
          <div>
            <Button size="sm" variant="outline" onClick={() => setCreatedPassword(null)}>
              Entendi
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!open) {
    // O wrapper existe porque o pai é um flex-col: sem ele o botão estica
    // pela largura toda do container.
    return (
      <div className="w-fit">
        <Button size="sm" onClick={() => setOpen(true)}>
          <UserPlus className="size-4" />
          Adicionar colaborador
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Novo colaborador</CardTitle>
        <CardDescription>Cria o acesso na hora — sem precisar de e-mail de convite.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="member-name" className="text-xs">
              Nome
            </Label>
            <Input
              id="member-name"
              className="w-48"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="member-email" className="text-xs">
              E-mail
            </Label>
            <Input
              id="member-email"
              type="email"
              className="w-60"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-xs">Permissão</Label>
            <div className="flex gap-2">
              {ROLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.description}
                  onClick={() => setRole(option.value)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition-colors",
                    role === option.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={creating || !name.trim() || !email.trim()}>
              {creating ? "Criando..." : "Criar"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
          {error ? <p className="w-full text-sm text-destructive">{error}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
