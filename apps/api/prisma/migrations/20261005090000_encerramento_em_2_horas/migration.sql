-- Encerramento automático: o padrão passa de 20 para 2 horas sem movimento.
ALTER TABLE "inbox_settings" ALTER COLUMN "autoCloseHours" SET DEFAULT 2;

-- Quem estava no padrão antigo (20) vai pro novo. Quem escolheu outro
-- número continua com o que escolheu.
UPDATE "inbox_settings" SET "autoCloseHours" = 2 WHERE "autoCloseHours" = 20;
