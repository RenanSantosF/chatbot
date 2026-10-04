-- O identificador @lid do WhatsApp, aprendido por cliente.
ALTER TABLE "customers" ADD COLUMN "whatsappLid" TEXT;

CREATE INDEX "customers_tenantId_whatsappLid_idx" ON "customers"("tenantId", "whatsappLid");
