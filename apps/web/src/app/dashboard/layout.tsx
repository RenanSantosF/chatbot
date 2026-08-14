import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { apiFetchServer } from "@/lib/api-server";
import type { MeResponse } from "@/lib/types";

/**
 * O painel fica fora do índice.
 *
 * Não por segredo — toda rota daqui exige sessão. É porque um robô que
 * insiste nelas só coleta redirecionamentos pro login, gasta o orçamento
 * de rastreamento que deveria ir pra landing, e ainda arrisca colocar um
 * "/dashboard/inbox" competindo com a página inicial no resultado de
 * busca. O robots.txt pede pra não visitar; isto garante que, se visitar
 * mesmo assim, não indexa.
 */
export const metadata: Metadata = {
  title: "Painel",
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await apiFetchServer<MeResponse>("/auth/me");

  if (!session) {
    redirect("/login");
  }

  return (
    <DashboardShell user={session.user} tenant={session.tenant}>
      {children}
    </DashboardShell>
  );
}
