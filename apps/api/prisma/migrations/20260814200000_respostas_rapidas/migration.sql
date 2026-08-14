-- Textos prontos que o atendente insere por um atalho.
--
-- Quem atende escreve as mesmas cinco frases o dia inteiro: a saudação, os
-- dados bancários, o endereço, o horário. É o trabalho manual mais óbvio
-- que sobra depois que a IA cuida do resto.
--
-- `shortcut` é o que se digita depois da barra ("/bomdia"), único por
-- empresa: dois atalhos iguais deixariam a escolha no ar.
CREATE TABLE "quick_replies" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "shortcut"   TEXT NOT NULL,
  "title"      TEXT,
  "content"    TEXT NOT NULL,
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "quick_replies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quick_replies_tenantId_shortcut_key"
  ON "quick_replies"("tenantId", "shortcut");

-- Ordena a lista pelo que a equipe de fato usa, e não por ordem de
-- cadastro: depois de uma semana o atalho certo é o primeiro, sem ninguém
-- ter organizado nada.
CREATE INDEX "quick_replies_tenantId_usageCount_idx"
  ON "quick_replies"("tenantId", "usageCount");

ALTER TABLE "quick_replies"
  ADD CONSTRAINT "quick_replies_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
