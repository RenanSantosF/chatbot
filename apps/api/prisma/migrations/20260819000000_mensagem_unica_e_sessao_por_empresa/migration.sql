-- A mesma mensagem do WhatsApp deixa de caber duas vezes na tabela.
--
-- A conferência antes de gravar já existia, e ela não bastava: ler e
-- depois escrever é uma corrida quando dois lotes do histórico chegam no
-- mesmo instante — que é a regra, e não a exceção, quando o aparelho
-- despeja milhares de mensagens em lotes que se sobrepõem. Foi assim que
-- a reconexão duplicou conversas inteiras no painel.
--
-- Antes do índice, as cópias que já entraram precisam sair.

-- 1. As respostas citadas passam a apontar pra cópia que fica.
--
-- Sem este passo, apagar a cópia levaria junto a tarjinha de "em resposta
-- a" de quem apontava pra ela (a chave é ON DELETE SET NULL).
WITH sobrevivente AS (
  SELECT
    "id",
    FIRST_VALUE("id") OVER (
      PARTITION BY "tenantId", "externalId"
      ORDER BY "createdAt", "id"
    ) AS "manter"
  FROM "messages"
  WHERE "externalId" IS NOT NULL
)
UPDATE "messages" m
SET "replyToId" = s."manter"
FROM sobrevivente s
WHERE m."replyToId" = s."id"
  AND s."id" <> s."manter";

-- 2. Fica a cópia mais antiga de cada mensagem; as outras saem.
--
-- A mais antiga e não a mais nova de propósito: é a que a conversa já
-- mostrava, a que tem as reações e as respostas apontando pra ela.
DELETE FROM "messages" m
USING "messages" outra
WHERE m."externalId" IS NOT NULL
  AND m."externalId" = outra."externalId"
  AND m."tenantId" = outra."tenantId"
  AND (outra."createdAt", outra."id") < (m."createdAt", m."id");

-- 3. E agora o banco garante o que o código só tentava garantir.
CREATE UNIQUE INDEX IF NOT EXISTS "messages_tenantId_externalId_key"
  ON "messages"("tenantId", "externalId");

-- O índice só por externalId vira peso morto: toda busca chega com o
-- tenant fixado pela extensão de isolamento, e o composto acima já a
-- atende.
DROP INDEX IF EXISTS "messages_externalId_idx";

-- Um segredo de webhook por empresa, sem repetição.
--
-- Duas linhas com o mesmo segredo faziam a entrega ser autenticada e
-- depois atribuída a uma empresa qualquer das duas. Quando isso existir,
-- a linha mais antiga fica com o segredo e as outras ganham um novo — o
-- endereço delas é registrado de novo na próxima conexão.
UPDATE "evolution_settings" e
SET "webhookSecret" = md5(random()::text || e."id") || substr(md5(random()::text || e."instance"), 1, 16)
WHERE EXISTS (
  SELECT 1 FROM "evolution_settings" outra
  WHERE outra."webhookSecret" = e."webhookSecret"
    AND (outra."createdAt", outra."id") < (e."createdAt", e."id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "evolution_settings_webhookSecret_key"
  ON "evolution_settings"("webhookSecret");

-- O pareamento que pode não ser de quem está escrito.
--
-- Enquanto o isolamento faltava, a segunda empresa a conectar reescrevia
-- a linha da primeira: o registro fica no nome de uma, e o celular
-- pareado é o da outra. Não dá pra descobrir de quem é olhando o banco —
-- e deixar como está entregaria a conversa de uma empresa no painel da
-- outra, que é o pior defeito possível aqui.
--
-- O sinal de que isso aconteceu é contável: mais empresas marcadas como
-- Evolution do que linhas de configuração. Quando bate, todas voltam pra
-- desconectado com um nome de sessão novo — nenhum evento da sessão
-- antiga é aceito, e cada empresa lê o QR code uma vez pra ficar com a
-- sua.
DO $$
BEGIN
  IF (SELECT count(*) FROM "tenants" WHERE "canal" = 'EVOLUTION')
     > (SELECT count(*) FROM "evolution_settings") THEN
    UPDATE "evolution_settings"
    SET "instance" = 'inteliwa-' || md5(random()::text || clock_timestamp()::text || "id"),
        "estado" = 'DESCONECTADO',
        "qrCode" = NULL,
        "pairingCode" = NULL,
        "connectedPhone" = NULL,
        "lastSeenAt" = NULL,
        "lastError" = 'a conexão anterior era compartilhada entre empresas por um defeito de isolamento; leia o QR code de novo pra ficar com a sua';
  END IF;
END
$$;
