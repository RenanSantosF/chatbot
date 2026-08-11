import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { apiFetchServer } from "@/lib/api-server";
import type { MeResponse } from "@/lib/types";

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
