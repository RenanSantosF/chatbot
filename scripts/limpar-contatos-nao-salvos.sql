-- Remove os contatos que a importação inventou.
--
-- POR QUE ISTO EXISTE
--
-- A sincronização da agenda aceitava como cadastro qualquer nome que
-- viesse da Evolution, inclusive `notify`/`pushName` — o apelido que a
-- própria pessoa escolhe e que TODO usuário do WhatsApp tem. Só que a
-- lista entregue pelo aparelho não é a agenda: é tudo que ele conhece,
-- incluindo quem escreveu uma vez, participante de grupo e quem caiu numa
-- transmissão. Cada um deles virou cliente, com nome e cara de contato
-- salvo.
--
-- O código já não faz mais isso (só `name`, o campo da agenda do aparelho,
-- cria cadastro). Mas nada apaga sozinho o que já entrou, e por isso este
-- arquivo: rode UMA vez, depois de atualizar a API.
--
-- COMO RODAR
--
-- No editor de SQL do Supabase (Database > SQL Editor). Rode a PARTE 1
-- primeiro e olhe o resultado; só depois rode a PARTE 2.
--
-- O QUE ELE NÃO APAGA
--
-- Só sai quem não deixou rastro nenhum: sem conversa e sem anotação. Quem
-- já foi atendido fica, mesmo que tenha entrado por engano — o histórico
-- de atendimento vale mais que a lista arrumada. Contato que você cadastrou
-- na mão e ainda não usou para nada é indistinguível de contato importado,
-- e por isso a PARTE 1 existe: confira a lista antes.


-- =====================================================================
-- PARTE 1 — o que seria apagado (não apaga nada)
-- =====================================================================

SELECT c.id, c.name, c.phone, c."createdAt"
FROM customers c
WHERE NOT EXISTS (
        SELECT 1 FROM conversations v WHERE v."customerId" = c.id
      )
  AND NOT EXISTS (
        SELECT 1 FROM customer_notes n WHERE n."customerId" = c.id
      )
ORDER BY c."createdAt" DESC;

-- Quantos são, e quantos ficam:
--
--   SELECT count(*) FILTER (WHERE sem_rastro) AS saem,
--          count(*) FILTER (WHERE NOT sem_rastro) AS ficam
--   FROM (
--     SELECT NOT EXISTS (SELECT 1 FROM conversations v WHERE v."customerId" = c.id)
--        AND NOT EXISTS (SELECT 1 FROM customer_notes n WHERE n."customerId" = c.id)
--            AS sem_rastro
--     FROM customers c
--   ) t;


-- =====================================================================
-- PARTE 2 — apaga (rode só depois de conferir a PARTE 1)
-- =====================================================================

-- DELETE FROM customers c
-- WHERE NOT EXISTS (
--         SELECT 1 FROM conversations v WHERE v."customerId" = c.id
--       )
--   AND NOT EXISTS (
--         SELECT 1 FROM customer_notes n WHERE n."customerId" = c.id
--       );


-- ---------------------------------------------------------------------
-- Se você tem mais de uma empresa no mesmo banco, ou cadastrou contatos
-- na mão ANTES de conectar o WhatsApp, acrescente um recorte às duas
-- partes. O `tenantId` sai de `SELECT id, name FROM tenants;`:
--
--   AND c."tenantId" = 'cole-o-id-aqui'
--
-- E para poupar o que é anterior à importação, use a data em que você
-- conectou o aparelho:
--
--   AND c."createdAt" > '2026-08-16'
-- ---------------------------------------------------------------------
