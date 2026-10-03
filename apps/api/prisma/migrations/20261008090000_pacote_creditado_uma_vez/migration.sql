-- Pacote extra creditado uma vez só, mesmo com o Stripe reenviando o aviso.
CREATE TABLE "pacotes_creditados" (
    "sessaoId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pacotes_creditados_pkey" PRIMARY KEY ("sessaoId")
);

CREATE INDEX "pacotes_creditados_tenantId_idx" ON "pacotes_creditados"("tenantId");

ALTER TABLE "pacotes_creditados" ADD CONSTRAINT "pacotes_creditados_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
