import { redirect } from "next/navigation";
import { apiFetchServer } from "@/lib/api-server";
import type { MeResponse } from "@/lib/types";

export default async function Home() {
  const session = await apiFetchServer<MeResponse>("/auth/me");
  redirect(session ? "/dashboard" : "/login");
}
