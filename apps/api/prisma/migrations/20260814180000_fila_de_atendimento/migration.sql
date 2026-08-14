-- Desde quando o cliente está esperando resposta.
--
-- A lista do Inbox sempre ordenou por mensagem mais recente, que é o que
-- todo mensageiro faz. O efeito colateral só aparece com volume: quem
-- escreve de novo sobe, e quem escreveu uma vez e ficou quieto esperando
-- afunda na lista. O cliente educado é o que fica sem atendimento.
--
-- Com esta coluna dá pra ordenar por tempo de espera de verdade, sem
-- perder a ordenação de mensageiro — são duas leituras da mesma caixa.

ALTER TABLE "conversations" ADD COLUMN "waitingSince" TIMESTAMP(3);

-- Backfill: a primeira mensagem do cliente que ainda não teve resposta da
-- empresa depois dela.
--
-- Sem isto a fila nasceria vazia e só se encheria com o movimento de
-- amanhã — as conversas que já estão esperando agora, que são exatamente
-- as que motivaram o recurso, ficariam de fora.
UPDATE "conversations" c
SET "waitingSince" = pendente.desde
FROM (
  SELECT m."conversationId", MIN(m."createdAt") AS desde
  FROM "messages" m
  WHERE m."senderType" = 'CUSTOMER'
    AND m."deletedAt" IS NULL
    -- "Sem resposta depois dela": nenhuma mensagem da empresa com data
    -- igual ou posterior. Comparar por NOT EXISTS evita depender do tipo
    -- exato do timestamp.
    AND NOT EXISTS (
      SELECT 1
      FROM "messages" resposta
      WHERE resposta."conversationId" = m."conversationId"
        AND resposta."senderType" IN ('AGENT', 'AI')
        AND resposta."createdAt" >= m."createdAt"
    )
  GROUP BY m."conversationId"
) AS pendente
WHERE c."id" = pendente."conversationId";

CREATE INDEX "conversations_tenantId_waitingSince_idx"
  ON "conversations"("tenantId", "waitingSince");
