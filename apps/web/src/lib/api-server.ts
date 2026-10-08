import "server-only";
import { cookies } from "next/headers";
import { ApiError, parseErrorMessage } from "./api-error";
import type { MeResponse } from "./types";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:3001";

/** Respostas que são da borda (API reiniciando), e não da API. */
const FORA_DO_AR = new Set([502, 503, 504]);
const ESPERA_ENTRE_TENTATIVAS_MS = 1500;

/**
 * Uma segunda chance quando a API está subindo.
 *
 * Num deploy ou reinício, a borda do Railway responde 502 ("Application
 * failed to respond") por alguns segundos. O layout do painel pergunta
 * `/auth/me` a cada tela, e esse 502 derrubava a página inteira com o
 * "This page couldn't load" do Next — mesmo a API voltando um instante
 * depois. Tenta de novo uma vez, com uma pausa curta; se continuar fora,
 * aí sim o erro sobe (e a tela de erro do app oferece tentar de novo).
 */
async function buscarComNovaTentativa(url: string, init: RequestInit): Promise<Response> {
  try {
    const res = await fetch(url, init);
    if (!FORA_DO_AR.has(res.status)) return res;
  } catch {
    // Conexão recusada: o processo da API nem está ouvindo ainda.
  }
  await new Promise((resolve) => setTimeout(resolve, ESPERA_ENTRE_TENTATIVAS_MS));
  return fetch(url, init);
}

/**
 * Fetch do lado do servidor (Server Components/layouts), chamado direto na
 * API (sem passar pelo rewrite do Next, que só existe pro navegador).
 * Encaminha manualmente o cookie de sessão que o navegador mandou pro
 * Next.js — necessário porque esta chamada roda em outro processo/origem.
 */
export async function apiFetchServer<T>(path: string): Promise<T | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const res = await buscarComNovaTentativa(`${API_INTERNAL_URL}/api${path}`, {
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
