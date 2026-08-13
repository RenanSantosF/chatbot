"use client";

import { createContext, useContext } from "react";
import type { SessionTenant, SessionUser } from "@/lib/types";

/**
 * Quem está logado, disponível para qualquer tela cliente.
 *
 * O layout do painel já busca `/auth/me` no servidor; sem este contexto
 * cada tela que precisa saber "essa conversa é minha?" teria que buscar de
 * novo no navegador — uma requisição a mais só pra repetir o que a página
 * já sabia ao renderizar.
 */
const SessionContext = createContext<{ user: SessionUser; tenant: SessionTenant } | null>(null);

export function SessionProvider({
  user,
  tenant,
  children,
}: {
  user: SessionUser;
  tenant: SessionTenant;
  children: React.ReactNode;
}) {
  return <SessionContext value={{ user, tenant }}>{children}</SessionContext>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession precisa estar dentro do painel (SessionProvider).");
  }
  return session;
}
