export interface WhatsAppMedia {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
}

export interface WhatsAppInboundMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  // Mídia: a Meta manda só um id; o binário é buscado depois em
  // GET /{media-id} e só com o token do tenant (ver WhatsappMediaService).
  image?: WhatsAppMedia;
  document?: WhatsAppMedia;
  audio?: WhatsAppMedia;
  video?: WhatsAppMedia;
  sticker?: WhatsAppMedia;
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
  contacts?: Array<{ name?: { formatted_name?: string } }>;
  // Resposta citada: id da mensagem original na Meta.
  context?: { id?: string; from?: string };
  reaction?: { message_id?: string; emoji?: string };
}

/**
 * Mensagem que a empresa mandou pelo aplicativo do celular, não por aqui.
 *
 * Chega quando o número está em coexistência (aplicativo WhatsApp Business e
 * Cloud API no mesmo número). Repare que aqui o destinatário é o cliente:
 * `from` é a empresa e `to` é quem vamos procurar na base — o oposto de uma
 * mensagem recebida.
 */
export interface WhatsAppMessageEcho extends WhatsAppInboundMessage {
  to?: string;
}

/**
 * Um contato da agenda do aparelho, vindo do campo `smb_app_state_sync`.
 *
 * Só existe em coexistência: a Meta sincroniza a agenda do WhatsApp Business
 * do celular e avisa a cada inclusão, alteração ou remoção. Em `remove` o
 * nome não vem — só o telefone.
 */
export interface WhatsAppStateSync {
  type?: string;
  action?: 'add' | 'remove';
  contact?: {
    full_name?: string;
    first_name?: string;
    phone_number?: string;
  };
  metadata?: { timestamp?: string };
}

/**
 * Um pedaço do histórico anterior ao onboarding (campo `history`).
 *
 * A Meta manda em fases (0: até 1 dia, 1: até 90 dias, 2: até 180) e cada
 * fase pode vir picada em vários webhooks. `progress` vai de 0 a 100 e é a
 * única forma de saber que acabou. Conversa em grupo não vem.
 */
export interface WhatsAppHistory {
  metadata?: {
    phase?: number;
    chunk_order?: number;
    progress?: number;
  };
  threads?: Array<{
    /** Telefone do cliente daquela conversa. */
    id?: string;
    messages?: Array<
      WhatsAppInboundMessage & {
        /** Pra quem foi, quando a mensagem é da empresa. */
        to?: string;
        history_context?: { status?: string };
      }
    >;
  }>;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

export interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: WhatsAppInboundMessage[];
        /** Campo `smb_message_echoes` — respostas dadas pelo celular. */
        message_echoes?: WhatsAppMessageEcho[];
        /** Campo `smb_app_state_sync` — agenda de contatos do aparelho. */
        state_sync?: WhatsAppStateSync[];
        /** Campo `history` — conversas anteriores ao onboarding. */
        history?: WhatsAppHistory[];
        statuses?: Array<{
          id?: string;
          status?: string;
          recipient_id?: string;
          errors?: Array<{
            code?: number;
            title?: string;
            message?: string;
            error_data?: { details?: string };
          }>;
        }>;
      };
    }>;
  }>;
}
