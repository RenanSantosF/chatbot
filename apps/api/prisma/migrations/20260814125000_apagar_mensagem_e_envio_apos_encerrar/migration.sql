-- AlterTable
ALTER TABLE "inbox_settings" ADD COLUMN     "allowSendWhenResolved" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;
