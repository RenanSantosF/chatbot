-- O que a empresa conta sobre si na primeira entrada.
--
-- Fora do formulário de cadastro de propósito: cada campo a mais na tela de
-- criar conta derruba a conversão, e perguntar faturamento antes de a
-- pessoa ver o produto funcionando soa como qualificação pra ligação de
-- vendas. Perguntado depois, com a conta já criada, o mesmo dado custa zero
-- em conversão e ainda vira personalização.
--
-- JSONB porque a lista de perguntas vai mudar, e mudar pergunta de pesquisa
-- não deveria custar migração de banco.
ALTER TABLE "tenants" ADD COLUMN "profile" JSONB;

-- Nulo = ainda não passou pela primeira configuração. É o que decide se a
-- boas-vindas aparece.
ALTER TABLE "tenants" ADD COLUMN "onboardedAt" TIMESTAMP(3);

-- Quem já estava dentro não merece ser recebido como novato: conta antiga
-- entra marcada como concluída.
UPDATE "tenants" SET "onboardedAt" = "createdAt" WHERE "onboardedAt" IS NULL;
