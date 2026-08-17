-- Em que pé está a trazida das conversas que já estavam no aparelho.
CREATE TYPE "EvolutionHistorico" AS ENUM ('NUNCA', 'IMPORTANDO', 'CONCLUIDO');

ALTER TABLE "evolution_settings"
  ADD COLUMN "historicoEstado" "EvolutionHistorico" NOT NULL DEFAULT 'NUNCA',
  ADD COLUMN "historicoMensagens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "historicoIniciadoEm" TIMESTAMP(3),
  ADD COLUMN "historicoConcluidoEm" TIMESTAMP(3);
