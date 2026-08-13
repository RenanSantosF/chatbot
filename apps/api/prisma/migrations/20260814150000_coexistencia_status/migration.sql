-- AlterTable
ALTER TABLE "whatsapp_settings" ADD COLUMN     "coexistenceSeenAt" TIMESTAMP(3),
ADD COLUMN     "contactsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "contactsSyncedAt" TIMESTAMP(3),
ADD COLUMN     "historyError" TEXT,
ADD COLUMN     "historyMessages" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "historyProgress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "historySyncedAt" TIMESTAMP(3);
