-- Quem entrega a mensagem passa a ser uma escolha por empresa.
--
-- META_CLOUD é a plataforma oficial: exige verificação, análise de app e
-- modelo aprovado pra falar fora da janela de 24h, e cobra por mensagem.
-- EVOLUTION é um servidor próprio falando pelo protocolo de aparelho
-- vinculado: conecta por QR code, não custa por mensagem e não passa por
-- aprovação — em troca, a sessão cai de vez em quando e o número do cliente
-- corre risco de bloqueio.
--
-- A escolha é comercial, não técnica. Guardá-la por empresa é o que permite
-- vender os dois no mesmo produto, em planos diferentes, sem manter dois
-- sistemas.
CREATE TYPE "CanalProvedor" AS ENUM ('META_CLOUD', 'EVOLUTION');

-- Todo mundo que já existe está no oficial, e continua.
ALTER TABLE "whatsapp_settings"
  ADD COLUMN "provider" "CanalProvedor" NOT NULL DEFAULT 'META_CLOUD';
