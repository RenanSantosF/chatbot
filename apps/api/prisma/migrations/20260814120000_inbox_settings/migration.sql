-- CreateTable
CREATE TABLE "inbox_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sendReadReceipts" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnResolve" BOOLEAN NOT NULL DEFAULT true,
    "resolveMessage" TEXT NOT NULL DEFAULT 'Atendimento encerrado por aqui. Se precisar de mais alguma coisa, é só mandar mensagem que a gente volta a te atender.',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbox_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inbox_settings_tenantId_key" ON "inbox_settings"("tenantId");

-- AddForeignKey
ALTER TABLE "inbox_settings" ADD CONSTRAINT "inbox_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "conversations_tenantId_lastMessageAt_idx" ON "conversations"("tenantId", "lastMessageAt" DESC);
