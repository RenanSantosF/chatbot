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

/**
 * De quem é o que está guardado agora.
 *
 * O cache vive numa variável de módulo — de propósito, pra sobreviver a
 * desmontar a tela. O preço disso é que trocar de conta na MESMA aba (sair
 * e entrar de novo como outra pessoa, ou outra empresa) é navegação de SPA,
 * não recarrega o processo, e essa variável não saberia sozinha que a
 * sessão mudou. Sem isto, a segunda pessoa a usar a aba podia abrir uma
 * conversa e ver por um instante — antes da resposta do servidor chegar —
 * o que ficou em cache da conta anterior.
 *
 * `chaveDaSessao` entra em toda chamada porque é a tela (que já sabe quem
 * está logado via `useSession`) quem decide o que é "a mesma sessão", não
 * este módulo.
 */
let sessaoAtual: string | null = null;

function garantirSessao(chaveDaSessao: string) {
  if (sessaoAtual !== chaveDaSessao) {
    cache.clear();
    sessaoAtual = chaveDaSessao;
  }
}

export const conversationCache = {
  get(chaveDaSessao: string, id: string): CachedConversation | undefined {
    garantirSessao(chaveDaSessao);
    return cache.get(id);
  },

  set(chaveDaSessao: string, id: string, entry: Omit<CachedConversation, "fetchedAt">) {
    garantirSessao(chaveDaSessao);
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
  patchMessages(
    chaveDaSessao: string,
    id: string,
    messages: ConversationDetail["messages"],
  ) {
    garantirSessao(chaveDaSessao);
    const entry = cache.get(id);
    if (!entry) return;
    cache.set(id, { ...entry, detail: { ...entry.detail, messages } });
  },

  /** Chamado explicitamente no logout — não espera a próxima sessão pra limpar. */
  clear() {
    cache.clear();
    sessaoAtual = null;
  },
};
