-- O andamento da trazida das conversas do aparelho.
--
-- O aparelho manda o percentual em cada lote. Sem guardá-lo, a tela só
-- tinha um giro — e giro sem número, passado um minuto, é
-- indistinguível de travamento, mesmo quando está tudo indo bem.
ALTER TABLE "evolution_settings"
  ADD COLUMN "historicoProgresso" INTEGER NOT NULL DEFAULT 0;
