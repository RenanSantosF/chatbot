-- Conserta os grupos que estão no banco marcados como pessoa.
--
-- A marca `isGroup` era gravada só no nascimento do cliente. Quem entrou
-- por um caminho que não passava a bandeira ficou com ela errada, e o
-- estrago aparece de duas formas pra quem usa: o grupo não aparece na aba
-- Grupos (fica escondido dentro de "Tudo") e o sistema o trata como
-- cliente — inclusive deixando a IA responder nele.
--
-- O critério é o endereço, e ele não admite dúvida: no WhatsApp, `@g.us`
-- é grupo e nada mais é. Por isso dá pra corrigir em massa sem risco de
-- pegar alguém junto.
UPDATE "customers"
SET "isGroup" = true
WHERE "phone" LIKE '%@g.us'
  AND "isGroup" = false;

-- E as conversas desses grupos saem do comando da IA.
--
-- Sem isto a correção acima arruma a aba e deixa o pior de pé: a conversa
-- continua com `aiMode = AI_ACTIVE`, e a IA segue respondendo no grupo até
-- alguém desligar na mão, uma por uma. A trava no código impede que isso
-- volte a acontecer; esta linha limpa o que já aconteceu.
UPDATE "conversations"
SET "aiMode" = 'HUMAN_ACTIVE'
WHERE "aiMode" = 'AI_ACTIVE'
  AND "customerId" IN (SELECT "id" FROM "customers" WHERE "phone" LIKE '%@g.us');
