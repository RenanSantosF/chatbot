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
