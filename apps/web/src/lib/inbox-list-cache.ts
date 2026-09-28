"use client";

import type { InboxFilters } from "@/components/inbox/inbox-filters";
import { ordenarConversas, pertenceAoFiltro } from "@/lib/inbox-filtro";
import type { ConversationSummary } from "@/lib/types";

export interface CachedList {
  items: ConversationSummary[];
  nextCursor: string | null;
  fetchedAt: number;
  /**
   * O recorte que montou a lista. Com ele, uma conversa que muda (pelo
   * tempo real) entra ou sai desta aba mesmo com ela fechada — ver
   * `aplicarConversa`.
   */
  filtros?: InboxFilters;
  /** Em qual conexão do tempo real foi guardada (ver `emDia`). */
  conexao: number;
}

/** Mesma ideia do `conversationCache`: quantas vezes o socket (re)conectou. */
let conexao = 0;
let conectado = false;

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

  set(
    chaveDaSessao: string,
    chave: string,
    entry: Omit<CachedList, "fetchedAt" | "conexao">,
  ) {
    garantirSessao(chaveDaSessao);
    // Reinsere pra a chave ir pro fim da ordem de iteração do Map, que é a
    // ordem de inserção — assim o descarte abaixo tira sempre a mais antiga.
    cache.delete(chave);
    cache.set(chave, { ...entry, fetchedAt: Date.now(), conexao });

    if (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
  },

  /** Chamado explicitamente no logout — não espera a próxima sessão pra limpar. */
  /**
   * A aba foi montada nesta conexão e recebeu desde então tudo o que o
   * tempo real mandou — pode aparecer sem pedir ao servidor de novo.
   */
  emDia(chaveDaSessao: string, chave: string): boolean {
    garantirSessao(chaveDaSessao);
    const entry = cache.get(chave);
    return conectado && Boolean(entry?.filtros) && entry?.conexao === conexao;
  },

  novaConexao() {
    conexao += 1;
    conectado = true;
  },

  /** A conexão caiu: até voltar, o que está guardado pode ficar pra trás. */
  perdeuConexao() {
    conectado = false;
  },

  /**
   * Uma conversa mudou: entra, sai ou troca de lugar em TODA aba guardada.
   *
   * É o que faz as abas funcionarem como uma lista só. A conversa que foi
   * resolvida sai de "Pendentes" e aparece em "Resolvidas" na hora, sem
   * nenhuma das duas precisar ser aberta — quando a pessoa troca de aba,
   * a lista já está certa.
   *
   * Uma conversa que cairia DEPOIS da última carregada, numa aba que tem
   * mais páginas, não entra: ela pertence a uma página que ainda não veio,
   * e colá-la no fim embaralharia a ordem.
   */
  aplicarConversa(
    chaveDaSessao: string,
    conversa: ConversationSummary,
    userId: string,
  ) {
    garantirSessao(chaveDaSessao);
    for (const [chave, entry] of cache) {
      if (!entry.filtros) continue;
      const semEla = entry.items.filter((item) => item.id !== conversa.id);
      let items = semEla;
      if (pertenceAoFiltro(conversa, entry.filtros, userId)) {
        const ordenada = ordenarConversas([...semEla, conversa], entry.filtros.ordem);
        const posicao = ordenada.findIndex((item) => item.id === conversa.id);
        const caiNoFim = posicao === ordenada.length - 1;
        items = caiNoFim && entry.nextCursor ? semEla : ordenada;
      }
      cache.set(chave, { ...entry, items });
    }
  },

  clear() {
    cache.clear();
    sessaoAtual = null;
  },
};
