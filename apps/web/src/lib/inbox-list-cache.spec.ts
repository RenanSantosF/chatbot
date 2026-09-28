import { beforeEach, describe, expect, it } from "vitest";
import { inboxListCache } from "./inbox-list-cache";
import type { ConversationSummary } from "@/lib/types";

/**
 * Mesmo espírito do `conversation-cache.spec.ts`: o cache é uma variável
 * de módulo, isolada por sessão pelo mesmo motivo — trocar de conta na
 * mesma aba é navegação de SPA, não reinicia o processo.
 */
function listaFalsa(id: string): ConversationSummary[] {
  return [{ id } as unknown as ConversationSummary];
}

const SESSAO_ANA = "tenant-1:user-ana:AGENT";
const SESSAO_BRUNO = "tenant-1:user-bruno:AGENT";
const ABA_PENDENTES = "/conversations?statusGroup=PENDING";

beforeEach(() => {
  inboxListCache.clear();
});

describe("inboxListCache", () => {
  it("guarda e devolve uma página na mesma sessão", () => {
    inboxListCache.set(SESSAO_ANA, ABA_PENDENTES, {
      items: listaFalsa("conversa-1"),
      nextCursor: null,
    });

    expect(inboxListCache.get(SESSAO_ANA, ABA_PENDENTES)?.items[0].id).toBe(
      "conversa-1",
    );
  });

  it("trocar de sessão esvazia o que estava guardado", () => {
    inboxListCache.set(SESSAO_ANA, ABA_PENDENTES, {
      items: listaFalsa("conversa-1"),
      nextCursor: null,
    });

    const doBruno = inboxListCache.get(SESSAO_BRUNO, ABA_PENDENTES);

    expect(doBruno).toBeUndefined();
  });

  it("cada aba/recorte tem sua própria entrada", () => {
    const abaTudo = "/conversations?statusGroup=ALL";
    inboxListCache.set(SESSAO_ANA, ABA_PENDENTES, {
      items: listaFalsa("conversa-1"),
      nextCursor: null,
    });
    inboxListCache.set(SESSAO_ANA, abaTudo, {
      items: listaFalsa("conversa-2"),
      nextCursor: "cursor-1",
    });

    expect(inboxListCache.get(SESSAO_ANA, ABA_PENDENTES)?.items[0].id).toBe(
      "conversa-1",
    );
    expect(inboxListCache.get(SESSAO_ANA, abaTudo)?.items[0].id).toBe(
      "conversa-2",
    );
  });

  it("clear() explícito (logout) também esvazia", () => {
    inboxListCache.set(SESSAO_ANA, ABA_PENDENTES, {
      items: listaFalsa("conversa-1"),
      nextCursor: null,
    });

    inboxListCache.clear();

    expect(inboxListCache.get(SESSAO_ANA, ABA_PENDENTES)).toBeUndefined();
  });
});
