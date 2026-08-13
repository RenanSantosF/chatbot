"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/session-provider";
import { apiFetch } from "@/lib/api-client";
import type { UserRole } from "@/lib/types";

/**
 * Chaves de permissão do backend (ver PERMISSION_CATALOG na API). Só as
 * usadas pela tela precisam estar aqui — a matriz vem completa do servidor
 * de qualquer forma, e listar todas obrigaria a manter duas cópias iguais.
 */
export type PermissionKey =
  | "conversations.send"
  | "conversations.assign"
  | "conversations.resolve"
  | "conversations.priority"
  | "conversations.attachments"
  | "customers.view"
  | "metrics.view"
  | "ai.manage"
  | "knowledge.manage"
  | "queues.manage"
  | "routing.manage"
  | "whatsapp.manage"
  | "team.manage";

interface Matriz {
  roles: { role: Exclude<UserRole, "OWNER">; permissions: Record<PermissionKey, boolean> }[];
}

/**
 * O que a pessoa logada pode fazer.
 *
 * A API é a autoridade — ela recusa a requisição de quem não pode, e é isso
 * que protege os dados. Isto aqui é só pra tela conseguir DIZER o que está
 * bloqueado antes do clique: apresentar tudo como disponível e responder
 * com erro depois é o que fazia o atendente achar que o sistema tinha
 * quebrado, quando na verdade a configuração era essa.
 *
 * `carregando` existe pra não pintar meia interface como bloqueada durante
 * o instante em que a matriz ainda não chegou.
 */
export function usePermissions() {
  const { user } = useSession();
  const [matriz, setMatriz] = useState<Matriz | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    // O dono passa por cima de qualquer regra no backend, então não há o
    // que consultar: uma requisição a menos em toda tela do painel.
    if (user.role === "OWNER") return;
    apiFetch<Matriz>("/permissions").then(setMatriz).catch(() => setFalhou(true));
  }, [user.role]);

  const dono = user.role === "OWNER";
  const doPapel = matriz?.roles.find((linha) => linha.role === user.role)?.permissions;

  return {
    role: user.role,
    carregando: !dono && !doPapel && !falhou,
    /** Permissão granular. Na dúvida libera: quem manda de verdade é a API. */
    can: (key: PermissionKey) => dono || (doPapel ? doPapel[key] : true),
    /** Para o que o backend controla por papel, não por permissão. */
    hasRole: (...papeis: UserRole[]) => papeis.includes(user.role),
  };
}
