"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
import {
  campanhaGuardada,
  guardarCampanha,
  registrarPasso,
  visitante,
} from "@/lib/rastreio";
import { cn } from "@/lib/utils";

/**
 * "Onde nos conheceu?" — uma pergunta, opcional, em botões de um clique.
 *
 * Cada campo a mais no cadastro derruba a conversão, então nada de lista
 * suspensa nem obrigação: quem quiser responder toca num botão. É o que
 * diz ao dono do produto onde investir (ver o painel da plataforma).
 */
const ORIGENS = [
  { valor: "instagram", rotulo: "Instagram" },
  { valor: "indicacao", rotulo: "Indicação" },
  { valor: "google", rotulo: "Google" },
  { valor: "youtube", rotulo: "YouTube" },
  { valor: "tiktok", rotulo: "TikTok" },
  { valor: "facebook", rotulo: "Facebook" },
  { valor: "whatsapp", rotulo: "WhatsApp" },
  { valor: "outro", rotulo: "Outro" },
];

export default function RegisterPage() {
  const [companyName, setCompanyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [comoConheceu, setComoConheceu] = useState<string | null>(null);
  const [comoConheceuDetalhe, setComoConheceuDetalhe] = useState("");

  // O passo "abriu o cadastro" do funil — e a campanha, pra quem chegou
  // direto aqui por um link de anúncio, sem passar pela landing.
  useEffect(() => {
    guardarCampanha();
    registrarPasso("cadastro_aberto");
  }, []);

  /**
   * A última etapa do cadastro é o pagamento — não existe uso sem assinar.
   *
   * A conta nasce aqui (mesma chamada de sempre), mas quem acabou de se
   * cadastrar nunca chega a VER o painel antes de pagar: o navegador é
   * mandado direto pro Checkout do Stripe. Enquanto isso não acontece, o
   * BillingGuard do lado do servidor bloqueia qualquer outra rota mesmo
   * que alguém tente pular esta tela (ver app.module.ts) — este redirect
   * é a experiência boa, aquele guard é quem garante de verdade.
   */
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          companyName,
          ownerName,
          email,
          password,
          ...(comoConheceu ? { comoConheceu } : {}),
          ...(comoConheceu === "outro" && comoConheceuDetalhe.trim()
            ? { comoConheceuDetalhe: comoConheceuDetalhe.trim() }
            : {}),
          utm: campanhaGuardada(),
          visitante: visitante() ?? undefined,
        }),
      });
      const { url } = await apiFetch<{ url: string }>("/billing/checkout", { method: "POST" });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não deu pra criar sua conta agora.");
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm bg-transparent ring-0">
      <CardHeader className="px-0">
        <CardTitle className="text-2xl tracking-tight">Crie sua empresa</CardTitle>
        <CardDescription>
          Último passo depois deste formulário: a assinatura, direto no Checkout seguro do
          Stripe.
        </CardDescription>
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
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">
              Onde conheceu a Inteliwa?{" "}
              <span className="font-normal text-muted-foreground">(opcional)</span>
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {ORIGENS.map((origem) => (
                <button
                  key={origem.valor}
                  type="button"
                  aria-pressed={comoConheceu === origem.valor}
                  onClick={() =>
                    setComoConheceu((atual) => (atual === origem.valor ? null : origem.valor))
                  }
                  className={cn(
                    "rounded-full border px-3 py-1 text-[13px] transition-colors",
                    comoConheceu === origem.valor
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  {origem.rotulo}
                </button>
              ))}
            </div>
            {comoConheceu === "outro" ? (
              <Input
                aria-label="Onde nos conheceu"
                placeholder="Conta pra gente onde"
                value={comoConheceuDetalhe}
                onChange={(e) => setComoConheceuDetalhe(e.target.value)}
                maxLength={120}
              />
            ) : null}
          </fieldset>
          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-4 px-0">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Preparando pagamento..." : "Continuar para o pagamento"}
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
