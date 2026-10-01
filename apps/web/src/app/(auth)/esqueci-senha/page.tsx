"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
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

/**
 * "Esqueci minha senha".
 *
 * A resposta é a mesma exista ou não a conta: dizer "esse e-mail não tem
 * cadastro" entregaria a lista de clientes pra quem quisesse testar.
 */
export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/auth/esqueci-senha", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setEnviado(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não deu pra enviar agora. Tente de novo.");
    } finally {
      setLoading(false);
    }
  }

  if (enviado) {
    return (
      <Card className="w-full max-w-sm bg-transparent ring-0">
        <CardHeader className="px-0">
          <span className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MailCheck className="size-5" />
          </span>
          <CardTitle className="text-2xl tracking-tight">Confira seu e-mail</CardTitle>
          <CardDescription className="text-pretty">
            Se houver uma conta com <strong className="text-foreground">{email.trim()}</strong>,
            você vai receber um link pra criar uma senha nova. Ele vale por 30 minutos.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-3 px-0">
          <p className="text-sm text-muted-foreground text-pretty">
            Não chegou em alguns minutos? Olhe a caixa de spam ou{" "}
            <button
              type="button"
              onClick={() => setEnviado(false)}
              className="text-foreground underline underline-offset-4"
            >
              tente de novo
            </button>
            .
          </p>
          <Link href="/login" className="text-sm text-foreground underline underline-offset-4">
            Voltar pra entrar
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm bg-transparent ring-0">
      <CardHeader className="px-0">
        <CardTitle className="text-2xl tracking-tight">Esqueci minha senha</CardTitle>
        <CardDescription>Informe seu e-mail e mandamos um link pra criar uma senha nova.</CardDescription>
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
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-4 px-0">
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? <Spinner /> : null}
            {loading ? "Enviando..." : "Enviar link"}
          </Button>
          <Link href="/login" className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Lembrei a senha
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
