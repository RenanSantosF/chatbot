-- Encerramento automático passa a vir ligado, e avisando o cliente.
--
-- É proteção de custo antes de ser organização. Passadas 24h sem mensagem
-- do cliente, a janela de atendimento do WhatsApp fecha e responder passa a
-- exigir modelo aprovado — burocrático e COBRADO por mensagem. Conversa
-- esquecida em aberto é uma dessas contas esperando pra acontecer, e quem
-- desliga isso deveria estar escolhendo pagar, não descobrindo depois.
ALTER TABLE "inbox_settings" ALTER COLUMN "autoCloseIdle" SET DEFAULT true;

-- O aviso ao cliente, com o texto padrão.
ALTER TABLE "inbox_settings"
  ADD COLUMN "autoCloseNotify" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "autoCloseMessage" TEXT NOT NULL
    DEFAULT 'Olá! Percebemos que faz um tempo que você não interage nesta conversa e, para manter nosso atendimento organizado, vamos encerrá-la por aqui. Se precisar de ajuda novamente, é só nos chamar. Será um prazer atender você!';

-- Quem já estava cadastrado também ganha o recurso ligado.
--
-- Mudar o DEFAULT sozinho só valeria pra linha nova, e as empresas que já
-- existem são justamente as que têm conversa velha pendurada. O padrão
-- anterior era desligado e ninguém chegou a escolher o contrário — não há
-- decisão de dono sendo sobrescrita aqui, e o dono que quiser desligar tem
-- o interruptor na tela de Atendimento.
UPDATE "inbox_settings" SET "autoCloseIdle" = true WHERE "autoCloseIdle" = false;
