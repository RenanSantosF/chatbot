-- CreateTable
CREATE TABLE "retention_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "keepMessagesDays" INTEGER,
    "autoPurgeOnFull" BOOLEAN NOT NULL DEFAULT false,
    "lastPurgeAt" TIMESTAMP(3),
    "lastPurgeDeleted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quotaBytes" BIGINT NOT NULL DEFAULT 1073741824,
    "usedBytes" BIGINT NOT NULL DEFAULT 0,
    "measuredAt" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "planLabel" TEXT NOT NULL DEFAULT 'Grátis',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retention_settings_tenantId_key" ON "retention_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_accounts_tenantId_key" ON "billing_accounts"("tenantId");

-- CreateIndex
CREATE INDEX "billing_accounts_stripeCustomerId_idx" ON "billing_accounts"("stripeCustomerId");

-- AddForeignKey
ALTER TABLE "retention_settings" ADD CONSTRAINT "retention_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
