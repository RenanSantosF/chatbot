-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('GEMINI');

-- AlterTable
ALTER TABLE "ai_settings" ADD COLUMN     "apiKeyEncrypted" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "provider" "AiProviderKind" NOT NULL DEFAULT 'GEMINI';
