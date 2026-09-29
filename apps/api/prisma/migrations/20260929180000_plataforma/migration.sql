-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "comoConheceu" TEXT,
ADD COLUMN     "comoConheceuDetalhe" TEXT,
ADD COLUMN     "utm" JSONB,
ADD COLUMN     "visitante" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ultimoAcessoEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "eventos_da_plataforma" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "visitante" TEXT,
    "tenantId" TEXT,
    "userId" TEXT,
    "chave" TEXT,
    "dados" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_da_plataforma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erros_da_plataforma" (
    "id" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "assinatura" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "pilha" TEXT,
    "rota" TEXT,
    "status" INTEGER,
    "ocorrencias" INTEGER NOT NULL DEFAULT 1,
    "tenantId" TEXT,
    "userId" TEXT,
    "primeiraVez" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaVez" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvido" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "erros_da_plataforma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "eventos_da_plataforma_chave_key" ON "eventos_da_plataforma"("chave");

-- CreateIndex
CREATE INDEX "eventos_da_plataforma_tipo_createdAt_idx" ON "eventos_da_plataforma"("tipo", "createdAt");

-- CreateIndex
CREATE INDEX "eventos_da_plataforma_tenantId_tipo_idx" ON "eventos_da_plataforma"("tenantId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "erros_da_plataforma_assinatura_key" ON "erros_da_plataforma"("assinatura");

-- CreateIndex
CREATE INDEX "erros_da_plataforma_ultimaVez_idx" ON "erros_da_plataforma"("ultimaVez");

