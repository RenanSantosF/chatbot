-- As respostas de IA renovam no dia da assinatura, não mais no dia 1º.
ALTER TABLE "billing_accounts" ADD COLUMN "aiCicloDia" INTEGER;
