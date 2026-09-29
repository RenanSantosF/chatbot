import { beforeEach, describe, expect, it } from "vitest";
import { conversationCache } from "./conversation-cache";
import type { ConversationDetail } from "@/lib/types";

/**
 * O cache é uma variável de módulo — sobrevive a desmontar a tela, que é
 * o ponto dele (voltar numa conversa já vista é instantâneo). O preço é
 * que trocar de conta na MESMA aba é navegação de SPA, não reinicia o
 * processo: sem a `chaveDaSessao`, a segunda pessoa a usar a aba podia
 * herdar por um instante o que ficou em cache da conta anterior.
 */
function conversaFalsa(id: string): ConversationDetail {
  return {
    id,
    channel: "WHATSAPP",
    status: "OPEN",
    priority: "NORMAL",
    aiMode: "AI_ACTIVE",
    unreadCount: 0,
    tags: [],
    messages: [],
  } as unknown as ConversationDetail;
}

const SESSAO_ANA = "tenant-1:user-ana:AGENT";
const SESSAO_BRUNO = "tenant-1:user-bruno:AGENT";

beforeEach(() => {
  conversationCache.clear();
});

describe("conversationCache", () => {
  it("guarda e devolve uma conversa na mesma sessão", () => {
    conversationCache.set(SESSAO_ANA, "conversa-1", {
      detail: conversaFalsa("conversa-1"),
      messagesCursor: null,
    });

    expect(conversationCache.get(SESSAO_ANA, "conversa-1")?.detail.id).toBe(
      "conversa-1",
    );
  });

  it("trocar de sessão (outra pessoa logando na mesma aba) esvazia o que estava guardado", () => {
    conversationCache.set(SESSAO_ANA, "conversa-1", {
      detail: conversaFalsa("conversa-1"),
      messagesCursor: null,
    });

    // Ana saiu, Bruno entrou — SPA, sem recarregar a aba. É exatamente o
    // caso que não passa por um `clear()` explícito de logout.
    const doBruno = conversationCache.get(SESSAO_BRUNO, "conversa-1");

    expect(doBruno).toBeUndefined();
  });

  it("depois de trocar de sessão, o que a nova pessoa guarda funciona normalmente", () => {
    conversationCache.set(SESSAO_ANA, "conversa-1", {
      detail: conversaFalsa("conversa-1"),
      messagesCursor: null,
    });
    conversationCache.get(SESSAO_BRUNO, "conversa-1"); // troca de sessão

    conversationCache.set(SESSAO_BRUNO, "conversa-2", {
      detail: conversaFalsa("conversa-2"),
      messagesCursor: null,
    });

    expect(conversationCache.get(SESSAO_BRUNO, "conversa-2")?.detail.id).toBe(
      "conversa-2",
    );
  });

  it("voltar pra sessão de Ana depois de Bruno não ressuscita o que era dela", () => {
    // Cada troca de sessão é tratada como uma pessoa nova — mesmo que o
    // nome da chave já tenha aparecido antes na mesma aba.
    conversationCache.set(SESSAO_ANA, "conversa-1", {
      detail: conversaFalsa("conversa-1"),
      messagesCursor: null,
    });
    conversationCache.get(SESSAO_BRUNO, "conversa-1");

    expect(conversationCache.get(SESSAO_ANA, "conversa-1")).toBeUndefined();
  });

  it("clear() explícito (logout) também esvazia", () => {
    conversationCache.set(SESSAO_ANA, "conversa-1", {
      detail: conversaFalsa("conversa-1"),
      messagesCursor: null,
    });

    conversationCache.clear();

    expect(conversationCache.get(SESSAO_ANA, "conversa-1")).toBeUndefined();
  });

  it("patchMessages também respeita a sessão", () => {
    conversationCache.set(SESSAO_ANA, "conversa-1", {
      detail: conversaFalsa("conversa-1"),
      messagesCursor: null,
    });
    conversationCache.get(SESSAO_BRUNO, "conversa-1"); // troca de sessão

    // Sem entrada nenhuma pra "conversa-1" na sessão do Bruno — o patch
    // não deve reviver o que era da Ana.
    conversationCache.patchMessages(SESSAO_BRUNO, "conversa-1", []);

    expect(conversationCache.get(SESSAO_BRUNO, "conversa-1")).toBeUndefined();
  });
});

describe("prévias da lista", () => {
  const mensagem = (id: string) =>
    ({ id, content: id }) as unknown as ConversationDetail["messages"][number];

  it("a prévia que saiu da tela sai da memória; a aberta fica", () => {
    conversationCache.set(SESSAO_ANA, "vista", {
      detail: conversaFalsa("vista"),
      messagesCursor: null,
      previa: true,
    });
    conversationCache.set(SESSAO_ANA, "rolou-pra-fora", {
      detail: conversaFalsa("rolou-pra-fora"),
      messagesCursor: null,
      previa: true,
    });
    conversationCache.set(SESSAO_ANA, "aberta-antes", {
      detail: conversaFalsa("aberta-antes"),
      messagesCursor: null,
    });

    conversationCache.descartarPrevias(SESSAO_ANA, new Set(["vista"]));

    expect(conversationCache.get(SESSAO_ANA, "vista")).toBeDefined();
    expect(conversationCache.get(SESSAO_ANA, "rolou-pra-fora")).toBeUndefined();
    expect(conversationCache.get(SESSAO_ANA, "aberta-antes")).toBeDefined();
  });

  it("uma prévia não rebaixa a conversa que já estava guardada inteira", () => {
    conversationCache.set(SESSAO_ANA, "c1", {
      detail: conversaFalsa("c1"),
      messagesCursor: null,
    });
    conversationCache.set(SESSAO_ANA, "c1", {
      detail: conversaFalsa("c1"),
      messagesCursor: null,
      previa: true,
    });

    conversationCache.descartarPrevias(SESSAO_ANA, new Set());

    expect(conversationCache.get(SESSAO_ANA, "c1")).toBeDefined();
  });

  it("a conversa que recebe mensagem o dia todo não cresce sem fim", () => {
    conversationCache.set(SESSAO_ANA, "c1", {
      detail: conversaFalsa("c1"),
      messagesCursor: null,
    });
    for (let i = 0; i < 400; i += 1) {
      conversationCache.anexarMensagem(SESSAO_ANA, "c1", mensagem(`m${i}`));
    }

    const guardada = conversationCache.get(SESSAO_ANA, "c1");
    expect(guardada?.detail.messages).toHaveLength(150);
    expect(guardada?.detail.messages.at(-1)?.id).toBe("m399");
    // Rolar pra cima continua de onde a memória cortou.
    expect(guardada?.messagesCursor).toBe("m250");
  });
});
