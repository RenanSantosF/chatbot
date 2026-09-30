-- Correção de texto por IA: contador mensal por conta e a marca de quem já usou.
ALTER TABLE "billing_accounts" ADD COLUMN "aiCorrecoesNoPeriodo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "usouCorrecaoEm" TIMESTAMP(3);
