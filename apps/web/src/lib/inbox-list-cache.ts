"use client";

import type { ConversationSummary } from "@/lib/types";

export interface CachedList {
  items: ConversationSummary[];
  nextCursor: string | null;
  fetchedAt: number;
}

/**
 * Cache da PRIMEIRA página de cada aba/recorte do Inbox, no mesmo espírito
 * do `conversationCache`: voltar numa aba já visitada é instantâneo — sem
 * o esqueleto piscando — e a busca no servidor acontece em segundo plano
 * só pra reconciliar. Vive fora do React de propósito.
 *
 * Guardado em memória, não no localStorage: é lista de conversa de
 * cliente, mesmo raciocínio do cache de conversa aberta.
 */
const cache = new Map<string, CachedList>();

/** Teto generoso: são poucas combinações de aba/filtro por sessão de uso. */
const MAX_ENTRIES = 20;

/**
 * Mesma solução do `conversationCache` pro mesmo problema: o cache vive
 * numa variável de módulo, que sobrevive a trocar de conta na MESMA aba
 * (navegação de SPA, sem recarregar o processo). `chaveDaSessao` entra em
 * toda chamada porque é a tela quem sabe que a sessão mudou, não este
 * módulo.
 */
let sessaoAtual: string | null = null;

function garantirSessao(chaveDaSessao: string) {
  if (sessaoAtual !== chaveDaSessao) {
    cache.clear();
    sessaoAtual = chaveDaSessao;
  }
}

export const inboxListCache = {
  get(chaveDaSessao: string, chave: string): CachedList | undefined {
    garantirSessao(chaveDaSessao);
    return cache.get(chave);
  },

  set(chaveDaSessao: string, chave: string, entry: Omit<CachedList, "fetchedAt">) {
    garantirSessao(chaveDaSessao);
    // Reinsere pra a chave ir pro fim da ordem de iteração do Map, que é a
    // ordem de inserção — assim o descarte abaixo tira sempre a mais antiga.
    cache.delete(chave);
    cache.set(chave, { ...entry, fetchedAt: Date.now() });

    if (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
  },

  /** Chamado explicitamente no logout — não espera a próxima sessão pra limpar. */
  clear() {
    cache.clear();
    sessaoAtual = null;
  },
};
