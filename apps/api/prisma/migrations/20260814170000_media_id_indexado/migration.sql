-- Espelha o mediaId pra fora do JSON e indexa.
--
-- O proxy de anexo procura a mensagem dona de uma mídia a cada abertura de
-- conversa com foto/áudio e a cada arquivamento disparado pelo webhook.
-- A busca era por caminho dentro de `metadata` (Json), que nenhum índice
-- alcança: varredura completa da tabela de mensagens do tenant, que é a
-- tabela que mais cresce no sistema.

ALTER TABLE "messages" ADD COLUMN "mediaId" TEXT;

-- Backfill do que já existe. Sem isto, todo anexo enviado ou recebido
-- antes desta migração ficaria com a coluna vazia e deixaria de ser
-- encontrado — o painel mostraria o balão e o arquivo não abriria.
--
-- ->> devolve o texto do campo; a condição extra evita percorrer linha de
-- mensagem de texto, que é a maioria.
UPDATE "messages"
SET "mediaId" = "metadata" ->> 'mediaId'
WHERE "metadata" IS NOT NULL
  AND "metadata" ->> 'mediaId' IS NOT NULL;

CREATE INDEX "messages_tenantId_mediaId_idx" ON "messages"("tenantId", "mediaId");
