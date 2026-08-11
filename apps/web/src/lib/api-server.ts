import "server-only";
import { cookies } from "next/headers";
import { ApiError, parseErrorMessage } from "./api-error";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:3001";

/**
 * Fetch do lado do servidor (Server Components/layouts), chamado direto na
 * API (sem passar pelo rewrite do Next, que só existe pro navegador).
 * Encaminha manualmente o cookie de sessão que o navegador mandou pro
 * Next.js — necessário porque esta chamada roda em outro processo/origem.
 */
export async function apiFetchServer<T>(path: string): Promise<T | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const res = await fetch(`${API_INTERNAL_URL}/api${path}`, {
    headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
    cache: "no-store",
  });

  if (res.status === 401) {
    return null;
  }

  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorMessage(res));
  }

  return res.json() as Promise<T>;
}
