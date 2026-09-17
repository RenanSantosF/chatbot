-- AlterTable
ALTER TABLE "billing_accounts" ADD COLUMN     "aiInputTokensUsed" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "aiMonthlyMessageLimit" INTEGER NOT NULL DEFAULT 3000,
ADD COLUMN     "aiOutputTokensUsed" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "aiRepliesUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "aiUsagePeriodStart" TIMESTAMP(3);
