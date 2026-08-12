-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "AiMemoryMode" AS ENUM ('NONE', 'IMPORTANT_ONLY', 'FULL');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "status" "MessageStatus" NOT NULL DEFAULT 'SENT',
ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE INDEX "messages_externalId_idx" ON "messages"("externalId");

-- AlterTable
ALTER TABLE "ai_settings" ADD COLUMN     "memoryMode" "AiMemoryMode" NOT NULL DEFAULT 'IMPORTANT_ONLY';
