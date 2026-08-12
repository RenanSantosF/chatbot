"use client";

import { useEffect, useState } from "react";

/**
 * Estado que sobrevive a recarregar a página e a trocar de tela. Começa
 * sempre com o padrão e só lê o armazenado depois de montar — ler no
 * inicializador quebraria a hidratação, já que o servidor não tem acesso
 * ao localStorage e renderizaria outra coisa.
 */
export function usePersistedState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setValue({ ...fallback, ...(JSON.parse(stored) as T) });
      }
    } catch {
      // Armazenamento indisponível ou JSON corrompido: segue com o padrão.
    }
    setHydrated(true);
    // O fallback é literal do chamador e mudaria a cada render se entrasse
    // nas dependências; a chave é o que de fato identifica o valor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Sem armazenamento (aba anônima com cota cheia): não é erro fatal.
    }
  }, [key, value, hydrated]);

  return [value, setValue, hydrated] as const;
}
