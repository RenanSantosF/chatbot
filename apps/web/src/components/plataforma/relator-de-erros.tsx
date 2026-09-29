"use client";

import { useEffect } from "react";
import { ApiError } from "@/lib/api-error";

/** No máximo isto por página aberta: um laço de erro não pode virar enxurrada. */
const TETO_POR_PAGINA = 5;

/**
 * Manda os erros da tela pro painel da plataforma.
 *
 * Sem isto, erro de tela só existia no console de quem estava usando — e
 * quem usa não abre o console, só acha que o sistema "travou". O mesmo
 * erro é mandado uma vez por página, e o servidor ainda agrupa os iguais.
 */
export function RelatorDeErros() {
  useEffect(() => {
    const vistos = new Set<string>();

    const mandar = (mensagem: string, pilha?: string) => {
      if (!mensagem || vistos.has(mensagem) || vistos.size >= TETO_POR_PAGINA) return;
      // Extensão do navegador e script de terceiro não são erro nosso.
      if (/extension:\/\/|ResizeObserver loop/i.test(`${mensagem} ${pilha ?? ""}`)) return;
      vistos.add(mensagem);
      void fetch("/api/plataforma/erros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          mensagem: mensagem.slice(0, 500),
          pilha: pilha?.slice(0, 4000),
          rota: window.location.pathname,
        }),
      }).catch(() => {});
    };

    const aoErrar = (evento: ErrorEvent) =>
      mandar(evento.message, evento.error instanceof Error ? evento.error.stack : undefined);
    const aoRejeitar = (evento: PromiseRejectionEvent) => {
      const motivo = evento.reason;
      // Recusa da API (4xx) é o sistema dizendo "não" — a tela já mostra o
      // motivo. Os 5xx a própria API já registra do lado dela.
      if (motivo instanceof ApiError) return;
      if (motivo instanceof Error) mandar(motivo.message, motivo.stack);
      else if (typeof motivo === "string") mandar(motivo);
    };

    window.addEventListener("error", aoErrar);
    window.addEventListener("unhandledrejection", aoRejeitar);
    return () => {
      window.removeEventListener("error", aoErrar);
      window.removeEventListener("unhandledrejection", aoRejeitar);
    };
  }, []);

  return null;
}
