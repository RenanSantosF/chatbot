import { describe, expect, it } from "vitest";
import { avisoDeFimDaLiberacao } from "./liberacao";
import type { EstadoDaCobranca } from "./types";

const HORA = 60 * 60 * 1000;
const agora = Date.UTC(2026, 8, 29, 12);

const cobranca = (mudanca: Partial<EstadoDaCobranca>): EstadoDaCobranca => ({
  assinaturaAtiva: false,
  planLabel: "Grátis",
  bloqueado: false,
  emCarencia: false,
  vencidoDesde: null,
  bloqueiaEm: null,
  liberadoAte: null,
  motivo: "liberado",
  ...mudanca,
});

describe("aviso de fim dos dias liberados", () => {
  it("fica quieto enquanto faltam mais de 3 dias", () => {
    expect(avisoDeFimDaLiberacao(cobranca({ liberadoAte: agora + 80 * HORA }), agora)).toBeNull();
  });

  it("aparece nos 3 últimos dias; com folga, a cobrança fica pro fim", () => {
    expect(avisoDeFimDaLiberacao(cobranca({ liberadoAte: agora + 60 * HORA }), agora)).toEqual({
      ate: agora + 60 * HORA,
      restante: 60 * HORA,
      urgente: false,
      cobrancaNoFim: true,
    });
  });

  it("perto do fim, não promete cobrança no fim e fica urgente", () => {
    const aviso = avisoDeFimDaLiberacao(cobranca({ liberadoAte: agora + 10 * HORA }), agora);
    expect(aviso?.urgente).toBe(true);
    expect(aviso?.cobrancaNoFim).toBe(false);
  });

  it("não avisa quem assina, quem é master nem quem já acabou", () => {
    const perto = agora + 10 * HORA;
    expect(avisoDeFimDaLiberacao(cobranca({ liberadoAte: perto, assinaturaAtiva: true }), agora)).toBeNull();
    expect(avisoDeFimDaLiberacao(cobranca({ liberadoAte: perto, motivo: "plataforma" }), agora)).toBeNull();
    expect(avisoDeFimDaLiberacao(cobranca({ liberadoAte: agora - HORA, motivo: "bloqueado" }), agora)).toBeNull();
  });
});
