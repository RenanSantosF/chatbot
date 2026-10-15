-- Plano de R$ 89 com 2.500 respostas de IA: vale para as contas criadas daqui em diante.
-- As contas que já existem mantêm o limite que tinham.
ALTER TABLE "billing_accounts" ALTER COLUMN "aiMonthlyMessageLimit" SET DEFAULT 2500;
