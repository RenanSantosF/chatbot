-- Etiquetas de conversa ("Orçamento", "Reclamação", "Segunda via").
--
-- Três usos de uma vez: quem atende vê do que se trata antes de abrir, o
-- filtro separa por assunto, e o relatório ganha uma dimensão que ninguém
-- precisou programar.
--
-- A cor é guardada pelo NOME do tom ("ambar"), não pelo hexadecimal: o
-- painel tem tema claro e escuro, e uma cor cravada aqui ficaria ilegível
-- em um dos dois.
CREATE TABLE "tags" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "color"     TEXT NOT NULL DEFAULT 'cinza',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- Dois nomes iguais na mesma empresa viram duas etiquetas que ninguém
-- distingue na hora de escolher.
CREATE UNIQUE INDEX "tags_tenantId_name_key" ON "tags"("tenantId", "name");

-- A tabela do meio é explícita (e não a relação implícita do Prisma) porque
-- ela precisa do tenantId como todas as outras: sem ele, ficaria de fora do
-- isolamento por empresa que o resto do sistema aplica.
CREATE TABLE "conversation_tags" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "tagId"          TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "conversation_tags_pkey" PRIMARY KEY ("id")
);

-- A mesma etiqueta duas vezes na mesma conversa não quer dizer nada.
CREATE UNIQUE INDEX "conversation_tags_conversationId_tagId_key"
  ON "conversation_tags"("conversationId", "tagId");

-- Filtrar o Inbox por etiqueta passa por aqui.
CREATE INDEX "conversation_tags_tenantId_tagId_idx"
  ON "conversation_tags"("tenantId", "tagId");

ALTER TABLE "tags" ADD CONSTRAINT "tags_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Apagar a etiqueta tira ela das conversas, e não deixa ligação órfã.
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
