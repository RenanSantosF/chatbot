-- Tetos mensais de transcrição de áudio e de perguntas ao assistente do painel.
ALTER TABLE "billing_accounts" ADD COLUMN "aiTranscricoesNoPeriodo" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "aiCopilotoNoPeriodo" INTEGER NOT NULL DEFAULT 0;
