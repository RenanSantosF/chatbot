-- Avaliação do atendimento (nota de 1 a 5), desligada por padrão.
ALTER TABLE "inbox_settings" ADD COLUMN "avaliacaoAtiva" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "avaliacaoMensagem" TEXT NOT NULL DEFAULT 'De 1 a 5, que nota você dá para o nosso atendimento? Responda só com o número.';

ALTER TABLE "conversations" ADD COLUMN "avaliacaoPedidaEm" TIMESTAMP(3);

CREATE TABLE "avaliacoes_de_atendimento" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "nota" INTEGER NOT NULL,
    "atendenteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avaliacoes_de_atendimento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "avaliacoes_de_atendimento_tenantId_createdAt_idx" ON "avaliacoes_de_atendimento"("tenantId", "createdAt");

ALTER TABLE "avaliacoes_de_atendimento" ADD CONSTRAINT "avaliacoes_de_atendimento_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "avaliacoes_de_atendimento" ADD CONSTRAINT "avaliacoes_de_atendimento_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
