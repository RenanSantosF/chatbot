import { describe, expect, it } from "vitest";
import { pertenceAoFiltro } from "./inbox-filtro";
import type { InboxFilters } from "@/components/inbox/inbox-filters";
import type { ConversationUpdate, CustomerResumo } from "@/lib/types";

/**
 * `conversation.updated` chega pra QUALQUER conversa que a pessoa pode
 * ver — não só pra quem bate com o filtro aberto na tela. Sem checar
 * pertencimento, uma atualização entrava direto na lista: conversa
 * resolvida reaparecendo em Pendentes, grupo indo pra caixa de clientes,
 * conversa de colega furando "Minhas".
 */
const BASE: InboxFilters = {
  grupo: "ALL",
  grupos: false,
  status: "ALL",
  priority: "ALL",
  mine: false,
  unread: false,
  unassigned: false,
  comIa: false,
  waiting: false,
  ordem: "RECENTE",
  tagId: "",
  search: "",
};

const USER_ID = "user-ana";

function conversaBase(
  overrides: Partial<Omit<ConversationUpdate, "customer">> & {
    customer?: CustomerResumo;
  } = {},
): ConversationUpdate {
  return {
    id: "conversa-1",
    status: "OPEN",
    aiMode: "HUMAN_ACTIVE",
    priority: "NORMAL",
    unreadCount: 0,
    lastMessageAt: null,
    waitingSince: null,
    createdAt: "2026-08-14T12:00:00Z",
    customer: { id: "cliente-1", name: "Ana Cliente", phone: "5511999990000" },
    assignedUser: null,
    assignmentAccepted: true,
    queue: null,
    tags: [],
    ...overrides,
  } as ConversationUpdate;
}

describe("pertenceAoFiltro — eixo de grupos", () => {
  it("grupo do WhatsApp não entra na caixa de clientes", () => {
    const grupo = conversaBase({ customer: { id: "g1", name: "Time", phone: "1@g.us", isGroup: true } });

    expect(pertenceAoFiltro(grupo, { ...BASE, grupos: false }, USER_ID)).toBe(false);
  });

  it("conversa de cliente não entra na aba de grupos", () => {
    const cliente = conversaBase();

    expect(pertenceAoFiltro(cliente, { ...BASE, grupos: true }, USER_ID)).toBe(false);
  });

  it("grupo entra na própria aba", () => {
    const grupo = conversaBase({ customer: { id: "g1", name: "Time", phone: "1@g.us", isGroup: true } });

    expect(pertenceAoFiltro(grupo, { ...BASE, grupos: true }, USER_ID)).toBe(true);
  });
});

describe("pertenceAoFiltro — situação", () => {
  it("status exato ganha do grupo de trabalho", () => {
    const resolvida = conversaBase({ status: "RESOLVED" });

    expect(
      pertenceAoFiltro(resolvida, { ...BASE, status: "OPEN", grupo: "PENDING" }, USER_ID),
    ).toBe(false);
  });

  it("conversa resolvida some da aba de Pendentes", () => {
    const resolvida = conversaBase({ status: "RESOLVED" });

    expect(pertenceAoFiltro(resolvida, { ...BASE, grupo: "PENDING" }, USER_ID)).toBe(false);
  });

  it("conversa aberta permanece em Pendentes", () => {
    const aberta = conversaBase({ status: "OPEN" });

    expect(pertenceAoFiltro(aberta, { ...BASE, grupo: "PENDING" }, USER_ID)).toBe(true);
  });

  it("sem filtro de situação nenhum, qualquer status passa", () => {
    const resolvida = conversaBase({ status: "CLOSED" });

    expect(pertenceAoFiltro(resolvida, BASE, USER_ID)).toBe(true);
  });
});

describe("pertenceAoFiltro — com a IA", () => {
  it("Pendentes exclui o que está com a IA, do jeito que montarWhere também exclui", () => {
    const comIa = conversaBase({ aiMode: "AI_ACTIVE" });

    expect(pertenceAoFiltro(comIa, { ...BASE, grupo: "PENDING" }, USER_ID)).toBe(false);
  });

  it('"Com a IA" ligado exige exatamente o oposto', () => {
    const semIa = conversaBase({ aiMode: "HUMAN_ACTIVE" });

    expect(pertenceAoFiltro(semIa, { ...BASE, comIa: true }, USER_ID)).toBe(false);
  });

  it('"Com a IA" ligado deixa passar quem está com a IA', () => {
    const comIa = conversaBase({ aiMode: "AI_ACTIVE" });

    expect(pertenceAoFiltro(comIa, { ...BASE, comIa: true }, USER_ID)).toBe(true);
  });
});

describe("pertenceAoFiltro — minhas", () => {
  it("conversa de outro atendente não fura Minhas", () => {
    const doColega = conversaBase({
      assignedUser: { id: "user-bruno", name: "Bruno", email: "b@x.com", avatar: null },
    });

    expect(pertenceAoFiltro(doColega, { ...BASE, mine: true }, USER_ID)).toBe(false);
  });

  it("conversa da própria pessoa passa em Minhas", () => {
    const minha = conversaBase({
      assignedUser: { id: USER_ID, name: "Ana", email: "a@x.com", avatar: null },
    });

    expect(pertenceAoFiltro(minha, { ...BASE, mine: true }, USER_ID)).toBe(true);
  });
});

describe("pertenceAoFiltro — outros recortes", () => {
  it("etiqueta: só passa quem tem a etiqueta escolhida", () => {
    const semEtiqueta = conversaBase({ tags: [{ id: "tag-2", name: "Outra", color: "#000" }] });

    expect(pertenceAoFiltro(semEtiqueta, { ...BASE, tagId: "tag-1" }, USER_ID)).toBe(false);
  });

  it("prioridade: filtro exato", () => {
    const baixa = conversaBase({ priority: "LOW" });

    expect(pertenceAoFiltro(baixa, { ...BASE, priority: "URGENT" }, USER_ID)).toBe(false);
  });

  it("não lidas: zero não conta", () => {
    const lida = conversaBase({ unreadCount: 0 });

    expect(pertenceAoFiltro(lida, { ...BASE, unread: true }, USER_ID)).toBe(false);
  });

  it("sem dono: conversa atribuída não entra", () => {
    const atribuida = conversaBase({
      assignedUser: { id: "user-bruno", name: "Bruno", email: "b@x.com", avatar: null },
    });

    expect(pertenceAoFiltro(atribuida, { ...BASE, unassigned: true }, USER_ID)).toBe(false);
  });

  it("esperando resposta: sem waitingSince não entra", () => {
    const respondida = conversaBase({ waitingSince: null });

    expect(pertenceAoFiltro(respondida, { ...BASE, waiting: true }, USER_ID)).toBe(false);
  });

  it("busca: bate pelo nome, sem diferenciar maiúscula", () => {
    const cliente = conversaBase({ customer: { id: "c1", name: "Maria Souza", phone: "551199998888" } });

    expect(pertenceAoFiltro(cliente, { ...BASE, search: "maria" }, USER_ID)).toBe(true);
  });

  it("busca: bate pelo telefone", () => {
    const cliente = conversaBase({ customer: { id: "c1", name: "Maria Souza", phone: "551199998888" } });

    expect(pertenceAoFiltro(cliente, { ...BASE, search: "99998888" }, USER_ID)).toBe(true);
  });

  it("busca: não bate nem no nome nem no telefone", () => {
    const cliente = conversaBase({ customer: { id: "c1", name: "Maria Souza", phone: "551199998888" } });

    expect(pertenceAoFiltro(cliente, { ...BASE, search: "joão" }, USER_ID)).toBe(false);
  });
});
