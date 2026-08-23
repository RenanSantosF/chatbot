-- Onde ficam os navegadores inscritos pra receber aviso com o app fechado.
--
-- A notificação que existia era criada pela própria página, e por isso
-- morria junto com a aba: atendente que fechasse o navegador não era
-- avisado de nada. Guardando a inscrição aqui, o servidor consegue
-- empurrar o aviso pelo serviço de push do navegador, com ou sem o painel
-- aberto.
--
-- Uma linha POR APARELHO, e não por pessoa: quem atende do computador e do
-- celular precisa ser avisado nos dois.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    -- A URL que o navegador devolve ao inscrever. Única no mundo: é por ela
    -- que o upsert reconhece o mesmo aparelho voltando, em vez de criar uma
    -- inscrição nova a cada abertura do painel.
    "endpoint" TEXT NOT NULL,
    -- As duas chaves que cifram o conteúdo do aviso ponta a ponta.
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key"
    ON "push_subscriptions"("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_tenantId_idx"
    ON "push_subscriptions"("tenantId");
-- A busca por usuário existe pro caminho de desinscrever e pra limpeza
-- quando alguém sai da equipe.
CREATE INDEX IF NOT EXISTS "push_subscriptions_userId_idx"
    ON "push_subscriptions"("userId");

-- Cascata nos dois: inscrição é dado de sessão de um aparelho, não
-- histórico. Empresa encerrada ou pessoa removida da equipe não deixa
-- inscrição órfã recebendo aviso de conversa que ela não pode mais ver.
ALTER TABLE "push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
