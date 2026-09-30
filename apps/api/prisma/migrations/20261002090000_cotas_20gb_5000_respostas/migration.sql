-- Cota de armazenamento passa a contar os arquivos: sobe de 1 GB pra 20 GB.
-- Respostas de IA incluídas no mês: de 3.000 pra 5.000.
ALTER TABLE "billing_accounts" ALTER COLUMN "quotaBytes" SET DEFAULT 21474836480;
ALTER TABLE "billing_accounts" ALTER COLUMN "aiMonthlyMessageLimit" SET DEFAULT 5000;

-- Contas no padrão antigo sobem junto; quem tinha um valor combinado à mão fica como está.
UPDATE "billing_accounts" SET "quotaBytes" = 21474836480 WHERE "quotaBytes" = 1073741824;
UPDATE "billing_accounts" SET "aiMonthlyMessageLimit" = 5000 WHERE "aiMonthlyMessageLimit" = 3000;
