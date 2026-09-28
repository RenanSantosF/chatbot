"use client";

import type { ConversationDetail } from "@/lib/types";

export interface CachedConversation {
  detail: ConversationDetail;
  messagesCursor: string | null;
  fetchedAt: number;
  /** Em qual conexão do tempo real foi guardada (ver `conexao`). */
  conexao: number;
}

/**
 * Quantas vezes o tempo real (re)conectou.
 *
 * Uma entrada guardada DURANTE a conexão atual recebeu, pelo socket, toda
 * mensagem que chegou depois dela (ver `anexarMensagem`) — está em dia, e
 * pode abrir na hora mesmo com não lidas. Guardada numa conexão anterior,
 * pode ter perdido o que chegou durante a queda: o servidor não reenvia.
 */
let conexao = 0;
/** Sem conexão, nada é "em dia": o que chegar agora não chega aqui. */
let conectado = false;

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

  set(
    chaveDaSessao: string,
    id: string,
    entry: Omit<CachedConversation, "fetchedAt" | "conexao">,
  ) {
    garantirSessao(chaveDaSessao);
    // Reinsere pra a chave ir pro fim da ordem de iteração do Map, que é a
    // ordem de inserção — assim o descarte abaixo tira sempre a mais antiga.
    cache.delete(id);
    cache.set(id, { ...entry, fetchedAt: Date.now(), conexao });

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
  /**
   * A entrada existe e recebeu tudo pelo tempo real desde que foi guardada
   * — dá pra abrir a conversa com ela sem esperar o servidor.
   */
  emDia(chaveDaSessao: string, id: string): boolean {
    garantirSessao(chaveDaSessao);
    return conectado && cache.get(id)?.conexao === conexao;
  },

  /** O tempo real (re)conectou: o que foi guardado antes pode ter furos. */
  novaConexao() {
    conexao += 1;
    conectado = true;
  },

  /** A conexão caiu: até voltar, o que está guardado pode ficar pra trás. */
  perdeuConexao() {
    conectado = false;
  },

  /**
   * Mensagem nova de uma conversa que NÃO está aberta.
   *
   * É o que mantém o cache em dia: antes, só a conversa aberta recebia as
   * mensagens do socket, e abrir uma conversa com não lidas tinha de
   * esperar o servidor — o "carregando" entre um chat e outro.
   */
  anexarMensagem(
    chaveDaSessao: string,
    id: string,
    message: ConversationDetail["messages"][number],
  ) {
    garantirSessao(chaveDaSessao);
    const entry = cache.get(id);
    if (!entry || entry.detail.messages.some((m) => m.id === message.id)) return;
    entry.detail = { ...entry.detail, messages: [...entry.detail.messages, message] };
  },

  /** Status (tiques) ou conteúdo de uma mensagem já guardada. */
  atualizarMensagem(
    chaveDaSessao: string,
    id: string,
    messageId: string,
    mudanca: Partial<ConversationDetail["messages"][number]>,
  ) {
    garantirSessao(chaveDaSessao);
    const entry = cache.get(id);
    if (!entry) return;
    entry.detail = {
      ...entry.detail,
      messages: entry.detail.messages.map((m) =>
        m.id === messageId ? { ...m, ...mudanca } : m,
      ),
    };
  },

  clear() {
    cache.clear();
    sessaoAtual = null;
  },
};
