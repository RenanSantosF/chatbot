/*
  Warnings:

  - You are about to drop the column `apiKeyEncrypted` on the `ai_settings` table. All the data in the column will be lost.
  - You are about to drop the column `model` on the `ai_settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ai_settings" DROP COLUMN "apiKeyEncrypted",
DROP COLUMN "model";
