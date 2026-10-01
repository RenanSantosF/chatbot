"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
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
 * Onde o link do e-mail cai.
 *
 * Confere o link ANTES de mostrar o formulário: digitar duas vezes uma
 * senha nova pra só então descobrir que o link expirou é trabalho jogado
 * fora.
 */
export default function RedefinirSenhaPage() {
  return (
    <Suspense fallback={<Carregando />}>
      <RedefinirSenha />
    </Suspense>
  );
}

function Carregando() {
  return (
    <div className="flex w-full max-w-sm items-center justify-center py-16">
      <Spinner />
    </div>
  );
}

function RedefinirSenha() {
  const router = useRouter();
  const parametros = useSearchParams();
  // Guardado no primeiro render: logo depois ele sai da barra de endereço.
  const [token] = useState(() => parametros.get("token"));
  const [conferido, setConferido] = useState<boolean | null>(null);
  const estado = !token ? "invalido" : conferido === null ? "conferindo" : conferido ? "valido" : "invalido";
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    // O token sai da barra de endereço: não fica no histórico do
    // navegador nem vai junto se alguém copiar o endereço.
    window.history.replaceState(null, "", window.location.pathname);
    apiFetch<{ valido: boolean }>("/auth/redefinir-senha/conferir", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then(({ valido }) => setConferido(valido))
      .catch(() => setConferido(false));
  }, [token]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (senha.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (senha !== confirmacao) {
      setError("As duas senhas não estão iguais.");
      return;
    }
    setLoading(true);
    try {
      await apiFetch("/auth/redefinir-senha", {
        method: "POST",
        body: JSON.stringify({ token, senha }),
      });
      router.push("/login?senha=redefinida");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não deu pra salvar agora. Tente de novo.");
      setLoading(false);
    }
  }

  if (estado === "conferindo") return <Carregando />;

  if (estado === "invalido") {
    return (
      <Card className="w-full max-w-sm bg-transparent ring-0">
        <CardHeader className="px-0">
          <CardTitle className="text-2xl tracking-tight">Link expirado</CardTitle>
          <CardDescription className="text-pretty">
            Este link já foi usado ou passou dos 30 minutos. Peça um novo — leva um instante.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-4 px-0">
          <Button size="lg" className="w-full" render={<Link href="/esqueci-senha" />}>
            Pedir um link novo
          </Button>
          <Link href="/login" className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Voltar pra entrar
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm bg-transparent ring-0">
      <CardHeader className="px-0">
        <CardTitle className="text-2xl tracking-tight">Criar senha nova</CardTitle>
        <CardDescription className="text-pretty">
          Depois de salvar, quem estiver logado com a senha antiga sai da conta.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-4 px-0">
          <div className="flex flex-col gap-2">
            <Label htmlFor="senha">Senha nova</Label>
            <Input
              id="senha"
              type="password"
              autoComplete="new-password"
              autoFocus
              minLength={8}
              maxLength={72}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">Pelo menos 8 caracteres.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirmacao">Repita a senha nova</Label>
            <Input
              id="confirmacao"
              type="password"
              autoComplete="new-password"
              maxLength={72}
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              required
            />
          </div>
          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="px-0">
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? <Spinner /> : null}
            {loading ? "Salvando..." : "Salvar senha nova"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
