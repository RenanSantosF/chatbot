import { redirect } from "next/navigation";
import { apiFetchServer } from "@/lib/api-server";
import type { MeResponse } from "@/lib/types";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await apiFetchServer<MeResponse>("/auth/me");
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-muted/30 px-4 py-16">
      <span className="text-lg font-semibold tracking-tight">Clara</span>
      {children}
    </div>
  );
}
