import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { apiFetchServer } from "@/lib/api-server";
import type { MeResponse } from "@/lib/types";

export const metadata: Metadata = {
  title: "Criar conta",
  description:
    "Crie a conta da sua empresa em menos de 2 minutos e comece a atender no WhatsApp com inteligência artificial.",
  alternates: { canonical: "/register" },
};

/**
 * O cadastro em tela cheia, fora do casco de duas colunas do login.
 *
 * O login continua com a coluna verde de apresentação (ver (auth)/layout);
 * o cadastro é uma experiência própria, de ponta a ponta, com a prévia do
 * atendimento no lugar daquela coluna (ver AssistenteDeCadastro).
 */
export default async function CadastroLayout({ children }: { children: React.ReactNode }) {
  const session = await apiFetchServer<MeResponse>("/auth/me");
  if (session) {
    redirect("/dashboard");
  }
  return children;
}
