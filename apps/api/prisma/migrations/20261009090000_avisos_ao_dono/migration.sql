-- Aviso ao dono quando o WhatsApp cai, e o resumo semanal por e-mail.
ALTER TABLE "evolution_settings" ADD COLUMN "quedaDesde" TIMESTAMP(3),
ADD COLUMN "quedaAvisadaEm" TIMESTAMP(3);

ALTER TABLE "tenants" ADD COLUMN "relatorioSemanal" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "relatorioSemanalEm" TIMESTAMP(3);
