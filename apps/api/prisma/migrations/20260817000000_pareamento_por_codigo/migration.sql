-- Conectar informando o número, em vez de ler o QR code.
--
-- O WhatsApp aceita dois jeitos de vincular um aparelho: escanear a
-- imagem, ou digitar um código de oito caracteres no telefone que vai
-- atender. O segundo existe por um motivo prático que a imagem não
-- resolve: NO CELULAR NÃO DÁ PRA ESCANEAR A PRÓPRIA TELA. Quem abre o
-- painel pelo telefone — que é como boa parte do teste real acontece —
-- precisava de um segundo aparelho ou de um computador.
--
-- Tem um segundo caso, comercial: quando quem contrata não é quem tem o
-- aparelho. O dono conecta do escritório e o número fica na recepção; um
-- código se dita por telefone, um QR code não.
--
-- A coluna é irmã de `qrCode` e vive do mesmo jeito: nasce ao pedir a
-- conexão, é apagada quando o pareamento acontece, e não sobrevive a uma
-- desconexão. Guardar em vez de só devolver na resposta é o que faz o
-- código continuar na tela depois de um F5 — ele vale cerca de um minuto,
-- e perdê-lo por recarregar a página obrigaria a começar de novo.
ALTER TABLE "evolution_settings"
  ADD COLUMN IF NOT EXISTS "pairingCode" TEXT;
