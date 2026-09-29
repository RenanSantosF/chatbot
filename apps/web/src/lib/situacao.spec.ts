import { describe, expect, it } from "vitest";
import { situacaoDoAtendimento } from "./situacao";

const base = {
  status: "OPEN" as const,
  aiMode: "HUMAN_ACTIVE" as const,
  assignedUser: null,
  assignmentAccepted: true,
  queue: null,
};
const renan = { id: "u1", name: "Renan Ferreira", email: "r@x", avatar: null };

describe("situação do atendimento", () => {
  it("encerrado vence tudo", () => {
    expect(
      situacaoDoAtendimento({ ...base, status: "RESOLVED", assignedUser: renan }).rotulo,
    ).toBe("Finalizado");
  });

  it("com uma pessoa, pelo primeiro nome", () => {
    expect(situacaoDoAtendimento({ ...base, assignedUser: renan }).rotulo).toBe("Com Renan");
  });

  it("indicado sem aceite não é 'com' ninguém", () => {
    const s = situacaoDoAtendimento({ ...base, assignedUser: renan, assignmentAccepted: false });
    expect(s.rotulo).toBe("Esperando Renan aceitar");
    expect(s.tom).toBe("fila");
  });

  it("a IA respondendo", () => {
    expect(situacaoDoAtendimento({ ...base, aiMode: "AI_ACTIVE" }).rotulo).toBe("Com a IA");
  });

  it("sem ninguém e sem IA: esperando alguém assumir, com o setor", () => {
    const s = situacaoDoAtendimento({
      ...base,
      queue: { id: "q1", key: "fin", name: "Financeiro" } as never,
    });
    expect(s.rotulo).toBe("Esperando alguém assumir");
    expect(s.detalhe).toBe("Na fila de Financeiro.");
  });
});
