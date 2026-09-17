-- AlterTable
ALTER TABLE "billing_accounts" ADD COLUMN     "aiExtraMessagesThisPeriod" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "assinaturaVencidaEm" TIMESTAMP(3);
