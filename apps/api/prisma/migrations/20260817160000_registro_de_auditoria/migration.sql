-- O que a equipe fez, guardado pra quem responde pela empresa.
CREATE TYPE "AuditAction" AS ENUM (
  'MENSAGEM_APAGADA',
  'CONVERSA_TRANSFERIDA',
  'CONVERSA_ATRIBUIDA',
  'CONVERSA_RESOLVIDA',
  'CONVERSA_REABERTA',
  'PRIORIDADE_ALTERADA',
  'IA_REATIVADA',
  'CONFIGURACAO_ALTERADA',
  'COLABORADOR_CRIADO',
  'COLABORADOR_ALTERADO',
  'COLABORADOR_REMOVIDO',
  'WHATSAPP_CONECTADO',
  'WHATSAPP_DESCONECTADO'
);

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "action" "AuditAction" NOT NULL,
  "actorId" TEXT,
  "actorName" TEXT NOT NULL,
  "conversationId" TEXT,
  "resumo" TEXT NOT NULL,
  "snapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");
CREATE INDEX "audit_logs_tenantId_action_createdAt_idx" ON "audit_logs"("tenantId", "action", "createdAt");
CREATE INDEX "audit_logs_tenantId_conversationId_createdAt_idx" ON "audit_logs"("tenantId", "conversationId", "createdAt");

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull e não Cascade: demitir alguém não pode apagar o rastro do que a
-- pessoa fez. O nome continua legível em "actorName".
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
