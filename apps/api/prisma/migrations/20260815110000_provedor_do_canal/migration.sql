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

-- Fica no tenant, e não em whatsapp_settings, porque quem escolhe a
-- Evolution nunca cria aquela linha: não tem token da Meta nem número na
-- Cloud API. Guardar a escolha lá seria guardá-la num lugar que, pra
-- metade dos casos, não existe.
--
-- Todo mundo que já existe está no oficial, e continua.
ALTER TABLE "tenants"
  ADD COLUMN "canal" "CanalProvedor" NOT NULL DEFAULT 'META_CLOUD';

CREATE TYPE "EvolutionEstado" AS ENUM (
  'DESCONECTADO',
  'AGUARDANDO_QRCODE',
  'CONECTADO'
);

CREATE TABLE "evolution_settings" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "apiKeyEncrypted" TEXT NOT NULL,
  "instance" TEXT NOT NULL,
  "webhookSecret" TEXT NOT NULL,
  "estado" "EvolutionEstado" NOT NULL DEFAULT 'DESCONECTADO',
  "qrCode" TEXT,
  "connectedPhone" TEXT,
  "lastSeenAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "evolution_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "evolution_settings_tenantId_key"
  ON "evolution_settings"("tenantId");

-- O nome da sessão chega em todo webhook e é por ele que descobrimos de
-- qual empresa é a mensagem — mesmo papel do phone_number_id no caminho
-- oficial, e por isso único na plataforma inteira, não por empresa.
CREATE UNIQUE INDEX "evolution_settings_instance_key"
  ON "evolution_settings"("instance");

ALTER TABLE "evolution_settings"
  ADD CONSTRAINT "evolution_settings_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
