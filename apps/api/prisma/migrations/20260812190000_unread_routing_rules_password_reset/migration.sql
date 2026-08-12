-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "unreadCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "routing_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "minPriority" "ConversationPriority" NOT NULL DEFAULT 'NORMAL',
    "targetUserId" TEXT,
    "targetQueueId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priorityOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "routing_rules_tenantId_key_key" ON "routing_rules"("tenantId", "key");

-- CreateIndex
CREATE INDEX "routing_rules_tenantId_active_idx" ON "routing_rules"("tenantId", "active");

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_targetQueueId_fkey" FOREIGN KEY ("targetQueueId") REFERENCES "queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
