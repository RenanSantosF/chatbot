"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não deu pra entrar agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    // Sem o anel e sem fundo próprio: numa tela que já é só o formulário, o
    // cartão vira uma moldura em volta de nada. O que organiza aqui é o
    // espaço, não a caixa.
    <Card className="w-full max-w-sm bg-transparent ring-0">
      <CardHeader className="px-0">
        <CardTitle className="text-2xl tracking-tight">Entrar</CardTitle>
        <CardDescription>Acesse o painel de atendimento da sua empresa.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-4 px-0">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              placeholder="voce@empresa.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {/* O erro tem fundo próprio: uma linha vermelha solta some no
              meio dos campos, e quem errou a senha precisa achá-la. */}
          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-4 px-0">
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? <Spinner /> : null}
            {loading ? "Entrando..." : "Entrar"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Ainda não tem conta?{" "}
            <Link href="/register" className="text-foreground underline underline-offset-4">
              Criar empresa
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
