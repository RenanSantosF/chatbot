"use client";

import { useEffect } from "react";
import { guardarCampanha, registrarPasso } from "@/lib/rastreio";

/**
 * Conta a visita e o clique em "Começar" na landing.
 *
 * Um ouvinte só no documento, e não um em cada botão: a landing tem o
 * mesmo convite em quatro lugares, e todos levam ao cadastro.
 */
export function RastreioDaLanding() {
  useEffect(() => {
    guardarCampanha();
    registrarPasso("landing_visita");

    const aoClicar = (evento: MouseEvent) => {
      const alvo = (evento.target as HTMLElement | null)?.closest("a");
      if (alvo?.getAttribute("href") === "/register") registrarPasso("landing_cta");
    };
    document.addEventListener("click", aoClicar);
    return () => document.removeEventListener("click", aoClicar);
  }, []);

  return null;
}
