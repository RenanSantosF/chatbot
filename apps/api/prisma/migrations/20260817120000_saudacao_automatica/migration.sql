-- A primeira resposta sem depender de IA.
--
-- A empresa que acabou de conectar o WhatsApp quase nunca tem chave de
-- modelo no primeiro dia. Sem isto, o cliente escreve e não recebe nada
-- até alguém abrir o painel — e a impressão que fica é a de um número
-- abandonado.
--
-- Desligada por padrão: mandar texto em nome da empresa é escolha dela, e
-- um texto genérico saindo sem ninguém saber seria pior que o silêncio.
ALTER TABLE "inbox_settings"
  ADD COLUMN "greetingEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "greetingMessage" TEXT NOT NULL
    DEFAULT 'Olá! Recebemos sua mensagem e um atendente vai falar com você em instantes.';

-- A IA passa a nascer DESLIGADA.
--
-- Ela não funciona sem chave de modelo, e a empresa não tem uma no minuto
-- em que cria a conta. Nascendo ligada, toda mensagem do primeiro dia
-- batia num provedor sem credencial e virava escalonamento com motivo de
-- erro — o pior primeiro contato possível com o produto.
--
-- Só o PADRÃO muda: quem já está com ela ligada continua igual.
ALTER TABLE "ai_settings" ALTER COLUMN "active" SET DEFAULT false;
