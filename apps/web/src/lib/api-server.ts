import "server-only";
import { cookies } from "next/headers";
import { ApiError, parseErrorMessage } from "./api-error";
import type { MeResponse } from "./types";

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

/**
 * A sessão de quem abriu uma página PÚBLICA, se houver — só pra mandar
 * quem já entrou direto pro painel.
 *
 * Sem o cookie de sessão nem pergunta: quase todo visitante da landing
 * não tem conta, e cada visita custava uma chamada à API. No dia do
 * lançamento (ou com um robô de busca passando) essas chamadas batiam no
 * limite de requisições, e a resposta 429 virava erro 500 na landing.
 *
 * Pelo mesmo motivo, falhar ao perguntar é "sem sessão": a página pública
 * aparece, e quem tinha sessão entra pelo login como sempre.
 */
export async function sessaoNaPaginaPublica(): Promise<MeResponse | null> {
  const cookieStore = await cookies();
  if (!cookieStore.has("access_token")) return null;
  try {
    return await apiFetchServer<MeResponse>("/auth/me");
  } catch {
    return null;
  }
}
