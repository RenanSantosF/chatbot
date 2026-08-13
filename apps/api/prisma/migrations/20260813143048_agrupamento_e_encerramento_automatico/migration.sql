-- AlterTable
ALTER TABLE "inbox_settings" ADD COLUMN     "autoCloseHours" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "autoCloseIdle" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "groupByCustomer" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "groupWindowHours" INTEGER NOT NULL DEFAULT 72;
