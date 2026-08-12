"use client";

import type { ConversationDetail } from "@/lib/types";

export interface CachedConversation {
  detail: ConversationDetail;
  messagesCursor: string | null;
  fetchedAt: number;
}

/**
 * Cache de conversas abertas, no mesmo espírito do WhatsApp Web: voltar
 * numa conversa já visitada é instantâneo, e a busca no servidor acontece
 * em segundo plano só pra reconciliar. Vive fora do React de propósito —
 * sobrevive a desmontar a tela e não provoca re-render por si só.
 *
 * Guardado em memória, não no localStorage: histórico de conversa é dado
 * pessoal de cliente e não tem por que ficar no disco do navegador depois
 * que a aba fecha.
 */
const cache = new Map<string, CachedConversation>();

/** Teto pra a aba aberta o dia todo não virar um vazamento de memória. */
const MAX_ENTRIES = 30;

export const conversationCache = {
  get(id: string): CachedConversation | undefined {
    return cache.get(id);
  },

  set(id: string, entry: Omit<CachedConversation, "fetchedAt">) {
    // Reinsere pra a chave ir pro fim da ordem de iteração do Map, que é a
    // ordem de inserção — assim o descarte abaixo tira sempre a mais antiga.
    cache.delete(id);
    cache.set(id, { ...entry, fetchedAt: Date.now() });

    if (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
  },

  /** Atualiza só as mensagens de uma conversa já em cache. */
  patchMessages(id: string, messages: ConversationDetail["messages"]) {
    const entry = cache.get(id);
    if (!entry) return;
    cache.set(id, { ...entry, detail: { ...entry.detail, messages } });
  },

  clear() {
    cache.clear();
  },
};
