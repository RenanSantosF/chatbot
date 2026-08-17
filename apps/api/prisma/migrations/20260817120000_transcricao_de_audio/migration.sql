-- A IA passa a OUVIR o que o cliente falou.
--
-- Até aqui, áudio chegava ao modelo como "[o cliente enviou um áudio, que
-- você não consegue abrir]". Num escritório onde boa parte do cliente
-- prefere falar a digitar, isso é metade do atendimento fora do alcance da
-- IA — ela respondia cortesia ou pedia pra pessoa escrever.
--
-- A transcrição fica GUARDADA na mensagem por três motivos que se somam:
-- custa uma chamada ao modelo por áudio, o resultado não muda (a gravação
-- é a mesma), e é ela que a busca dentro da conversa precisa encontrar.
ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "transcricao" TEXT;

-- Quando quem atende é GENTE, transcrever é escolha do dono.
--
-- Com a IA respondendo não há escolha: sem ouvir ela não tem o que
-- responder. Para o atendente humano é conveniência — ele consegue ouvir —
-- e conveniência que custa uma chamada ao modelo por áudio precisa de
-- dono.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TranscricaoDeAudio') THEN
    CREATE TYPE "TranscricaoDeAudio" AS ENUM (
      'DESLIGADA',
      'SOB_DEMANDA',
      'AUTOMATICA'
    );
  END IF;
END
$$;

-- SOB_DEMANDA de padrão: ligar tudo sem avisar cobraria do dono uma
-- chamada por áudio recebido, e desligar esconderia um recurso que ele nem
-- saberia que existe.
ALTER TABLE "inbox_settings"
  ADD COLUMN IF NOT EXISTS "transcricaoDeAudio" "TranscricaoDeAudio"
  NOT NULL DEFAULT 'SOB_DEMANDA';
