import { MessagesSquare, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { apiFetchServer } from "@/lib/api-server";
import type { MeResponse } from "@/lib/types";

/**
 * Entrar e cadastrar dividem esta tela de duas colunas.
 *
 * A coluna da esquerda não é enfeite: entrar num painel de atendimento é um
 * gesto de trabalho, e um formulário sozinho no meio de um fundo cinza não
 * diz onde a pessoa chegou. Em telas estreitas ela some por completo — no
 * celular o que importa é o campo de senha, não o discurso.
 */
const PONTOS = [
  {
    icone: Sparkles,
    texto: "A IA responde o repetitivo e passa pra equipe o que precisa de gente.",
  },
  {
    icone: MessagesSquare,
    texto: "Todas as conversas do WhatsApp num painel só, com histórico completo.",
  },
  {
    icone: ShieldCheck,
    texto: "Anexos guardados além dos 30 dias em que o WhatsApp os apaga.",
  },
];

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await apiFetchServer<MeResponse>("/auth/me");
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:grid lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground lg:flex">
        {/* Duas manchas de luz atrás do texto. Sem elas o bloco vira um
            retângulo verde chapado; com elas ganha profundidade sem custar
            uma imagem pra carregar. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -left-16 size-96 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -bottom-24 size-80 rounded-full bg-black/10 blur-3xl"
        />

        <Link href="/" className="relative text-lg font-semibold tracking-tight">
          Clara
        </Link>

        <div className="relative flex flex-col gap-8">
          <p className="max-w-md text-3xl leading-tight font-semibold tracking-tight text-balance">
            Seu cliente pergunta às duas da manhã. Alguém responde.
          </p>

          <ul className="flex max-w-md flex-col gap-4">
            {PONTOS.map((ponto) => (
              <li key={ponto.texto} className="flex items-start gap-3">
                <ponto.icone className="mt-0.5 size-4.5 shrink-0 opacity-90" />
                <span className="text-sm leading-relaxed text-primary-foreground/90 text-pretty">
                  {ponto.texto}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-primary-foreground/70">
          Atendimento por WhatsApp com inteligência artificial.
        </p>
      </aside>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-5 py-12">
        {/* A marca aparece aqui só quando a coluna da esquerda não existe —
            repetir nas duas deixaria "Clara" duas vezes na mesma tela. */}
        <Link href="/" className="text-lg font-semibold tracking-tight lg:hidden">
          Clara
        </Link>

        {children}

        <p className="text-center text-xs text-muted-foreground">
          <Link href="/termos" className="underline underline-offset-4 hover:text-foreground">
            Termos de uso
          </Link>
          {" · "}
          <Link href="/privacidade" className="underline underline-offset-4 hover:text-foreground">
            Privacidade
          </Link>
        </p>
      </main>
    </div>
  );
}
