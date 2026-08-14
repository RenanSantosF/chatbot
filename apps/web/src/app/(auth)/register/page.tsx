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
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

export default function RegisterPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ companyName, ownerName, email, password }),
      });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não deu pra criar sua conta agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm bg-transparent ring-0">
      <CardHeader className="px-0">
        <CardTitle className="text-2xl tracking-tight">Crie sua empresa</CardTitle>
        <CardDescription>Comece a configurar sua IA de atendimento em minutos.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-4 px-0">
          <div className="flex flex-col gap-2">
            <Label htmlFor="companyName">Nome da empresa</Label>
            <Input
              id="companyName"
              placeholder="Escritório de Advocacia Exemplo"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              minLength={2}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ownerName">Seu nome</Label>
            <Input
              id="ownerName"
              placeholder="Seu nome completo"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              required
              minLength={2}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              placeholder="voce@empresa.com"
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
              placeholder="Pelo menos 8 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-4 px-0">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Criando conta..." : "Criar conta"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Já tem uma conta?{" "}
            <Link href="/login" className="text-foreground underline underline-offset-4">
              Entrar
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
