-- CreateTable
CREATE TABLE "historicos_guardados" (
    "conversationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mensagens" JSONB NOT NULL,
    "maisRecenteEm" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "historicos_guardados_pkey" PRIMARY KEY ("conversationId")
);

-- CreateIndex
CREATE INDEX "historicos_guardados_tenantId_maisRecenteEm_idx" ON "historicos_guardados"("tenantId", "maisRecenteEm");

-- AddForeignKey
ALTER TABLE "historicos_guardados" ADD CONSTRAINT "historicos_guardados_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historicos_guardados" ADD CONSTRAINT "historicos_guardados_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
