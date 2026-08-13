-- CreateEnum
CREATE TYPE "WhatsAppOnboarding" AS ENUM ('MANUAL', 'EMBEDDED_SIGNUP');

-- AlterTable
ALTER TABLE "whatsapp_settings" ADD COLUMN     "businessId" TEXT,
ADD COLUMN     "onboarding" "WhatsAppOnboarding" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "registrationPinEncrypted" TEXT,
ALTER COLUMN "appSecretEncrypted" DROP NOT NULL;
