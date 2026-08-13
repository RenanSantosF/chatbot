-- Renomeada de 20260813143048 pra cá: `inbox_settings` é criada por
-- 20260814120000, e com a data antiga esta migração rodava ANTES da tabela
-- existir. No banco de desenvolvimento passou despercebido (a tabela já
-- estava lá), mas um banco novo quebrava no deploy.
--
-- IF NOT EXISTS por causa da renomeação: em bancos que já aplicaram a versão
-- antiga, o novo nome entra como pendente e roda de novo — assim a segunda
-- passada não estoura.
ALTER TABLE "inbox_settings"
  ADD COLUMN IF NOT EXISTS "autoCloseHours"   INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "autoCloseIdle"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "groupByCustomer"  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "groupWindowHours" INTEGER NOT NULL DEFAULT 72;
