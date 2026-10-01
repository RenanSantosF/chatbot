-- "Esqueci minha senha": tokens de uso único (só o hash) e derrubada das
-- sessões antigas ao redefinir.
ALTER TABLE "users" ADD COLUMN "sessoesValidasDesde" TIMESTAMP(3);

CREATE TABLE "redefinicoes_de_senha" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redefinicoes_de_senha_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "redefinicoes_de_senha_tokenHash_key" ON "redefinicoes_de_senha"("tokenHash");
CREATE INDEX "redefinicoes_de_senha_userId_createdAt_idx" ON "redefinicoes_de_senha"("userId", "createdAt");

ALTER TABLE "redefinicoes_de_senha" ADD CONSTRAINT "redefinicoes_de_senha_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
