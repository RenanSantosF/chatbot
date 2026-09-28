import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, type InboxFilters } from "@/components/inbox/inbox-filters";
import { conversationCache } from "./conversation-cache";
import { inboxListCache } from "./inbox-list-cache";
import type { ConversationDetail, ConversationSummary } from "./types";

/**
 * As abas como uma lista só, e a conversa que abre sem esperar.
 *
 * O que estes testes seguram: uma conversa que muda (pelo tempo real)
 * entra e sai das abas GUARDADAS na hora, e uma conversa guardada nesta
 * conexão abre com as mensagens que chegaram depois dela.
 */
const SESSAO = "t1:u1:AGENT";

function conversa(
  id: string,
  mudanca: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id,
    status: "OPEN",
    aiMode: "HUMAN_ACTIVE",
    priority: "NORMAL",
    unreadCount: 0,
    lastMessageAt: "2026-09-28T10:00:00.000Z",
    waitingSince: null,
    createdAt: "2026-09-28T09:00:00.000Z",
    customer: { id: `c-${id}`, name: id, phone: "5527", isGroup: false },
    assignedUser: null,
    assignmentAccepted: true,
    queue: null,
    tags: [],
    ...mudanca,
  };
}

const PENDENTES: InboxFilters = { ...DEFAULT_FILTERS, ordem: "RECENTE", grupo: "PENDING" };
const RESOLVIDAS: InboxFilters = { ...PENDENTES, grupo: "DONE" };

function guardarAbas(pendentes: ConversationSummary[], resolvidas: ConversationSummary[]) {
  inboxListCache.set(SESSAO, "pendentes", { items: pendentes, nextCursor: null, filtros: PENDENTES });
  inboxListCache.set(SESSAO, "resolvidas", { items: resolvidas, nextCursor: null, filtros: RESOLVIDAS });
}

const ids = (chave: string) => inboxListCache.get(SESSAO, chave)?.items.map((c) => c.id);

beforeEach(() => {
  inboxListCache.clear();
  conversationCache.clear();
});

describe("abas em tempo real", () => {
  it("a conversa resolvida sai de Pendentes e entra em Resolvidas sem abrir nenhuma", () => {
    guardarAbas([conversa("a"), conversa("b")], [conversa("z", { status: "RESOLVED" })]);

    inboxListCache.aplicarConversa(
      SESSAO,
      conversa("a", { status: "RESOLVED", lastMessageAt: "2026-09-28T11:00:00.000Z" }),
      "u1",
    );

    expect(ids("pendentes")).toEqual(["b"]);
    expect(ids("resolvidas")).toEqual(["a", "z"]);
  });

  it("mensagem nova sobe a conversa pro topo da aba", () => {
    guardarAbas(
      [conversa("a", { lastMessageAt: "2026-09-28T10:05:00.000Z" }), conversa("b")],
      [],
    );
    inboxListCache.aplicarConversa(
      SESSAO,
      conversa("b", { lastMessageAt: "2026-09-28T10:10:00.000Z", unreadCount: 1 }),
      "u1",
    );
    expect(ids("pendentes")).toEqual(["b", "a"]);
  });

  it("não cola no fim de uma aba que ainda tem páginas por vir", () => {
    inboxListCache.set(SESSAO, "pendentes", {
      items: [conversa("a", { lastMessageAt: "2026-09-28T10:05:00.000Z" })],
      nextCursor: "a",
      filtros: PENDENTES,
    });
    inboxListCache.aplicarConversa(
      SESSAO,
      conversa("velha", { lastMessageAt: "2026-09-01T10:00:00.000Z" }),
      "u1",
    );
    expect(ids("pendentes")).toEqual(["a"]);
  });

  it("aba guardada vale como em dia só dentro da mesma conexão", () => {
    guardarAbas([], []);
    expect(inboxListCache.emDia(SESSAO, "pendentes")).toBe(true);
    inboxListCache.novaConexao();
    expect(inboxListCache.emDia(SESSAO, "pendentes")).toBe(false);
  });
});

describe("conversa em dia pelo tempo real", () => {
  const detalhe = (id: string) =>
    ({ ...conversa(id), messages: [{ id: "m1" }] }) as unknown as ConversationDetail;

  it("guarda as mensagens que chegam com a conversa fechada, sem duplicar", () => {
    conversationCache.set(SESSAO, "a", { detail: detalhe("a"), messagesCursor: null });
    const nova = { id: "m2" } as ConversationDetail["messages"][number];
    conversationCache.anexarMensagem(SESSAO, "a", nova);
    conversationCache.anexarMensagem(SESSAO, "a", nova);

    expect(conversationCache.get(SESSAO, "a")?.detail.messages.map((m) => m.id)).toEqual([
      "m1",
      "m2",
    ]);
    expect(conversationCache.emDia(SESSAO, "a")).toBe(true);
  });

  it("depois de a conexão cair e voltar, deixa de estar em dia", () => {
    conversationCache.set(SESSAO, "a", { detail: detalhe("a"), messagesCursor: null });
    conversationCache.novaConexao();
    expect(conversationCache.emDia(SESSAO, "a")).toBe(false);
    // ...até ser buscada de novo.
    conversationCache.set(SESSAO, "a", { detail: detalhe("a"), messagesCursor: null });
    expect(conversationCache.emDia(SESSAO, "a")).toBe(true);
  });
});
