"use client";

import { ApiError, parseErrorMessage } from "./api-error";

/**
 * Fetch do lado do navegador. Usa caminho relativo (/api/...) — o Next.js
 * faz o proxy pra API (ver next.config.ts), então isso sempre roda como
 * mesma origem, sem CORS e com o cookie de sessão anexado automaticamente.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorMessage(res));
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}
