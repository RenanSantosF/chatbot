-- Grupo do WhatsApp entra pela mesma porta que cliente.
--
-- Tudo o que o painel faz com uma conversa — histórico, etiquetas, busca,
-- anexo, responsável — faz sentido num grupo também, e por isso o grupo
-- reaproveita a conversa e o cliente em vez de ganhar uma estrutura
-- paralela. O que MUDA fica decidido por esta coluna: a IA nunca responde,
-- o relógio de espera não corre, a fila de pendentes não conta, e a lista
-- de Clientes não mostra.
--
-- No caso de grupo, `customers.phone` guarda o JID inteiro
-- (`120363...@g.us`) em vez de dígitos: grupo não tem telefone, e inventar
-- um só pra caber no formato faria o envio montar um destino inexistente.
ALTER TABLE "customers"
    ADD COLUMN IF NOT EXISTS "isGroup" BOOLEAN NOT NULL DEFAULT false;

-- A lista do Inbox alterna entre "conversas de cliente" e "grupos", e as
-- duas passam por aqui em toda abertura de tela. Sem o índice, cada troca
-- de aba varre a tabela de clientes inteira da empresa.
CREATE INDEX IF NOT EXISTS "customers_tenantId_isGroup_idx"
    ON "customers"("tenantId", "isGroup");
