export type WhatsAppProviderName = 'twilio' | 'meta';

export type WhatsAppInteractiveButton = {
  id: string;
  title: string;
};

export type SendWhatsAppMessageInput = {
  to: string;
  body: string;
  buttons?: WhatsAppInteractiveButton[];
};

export type SendWhatsAppMessageResult = {
  providerMessageId: string | null;
};

export type ParsedInboundWhatsAppMessage = {
  provider: WhatsAppProviderName;
  providerMessageId: string;
  from: string;
  profileName: string | null;
  body: string | null;
  rawPayload: Record<string, string | string[]>;
  receivedAt: Date;
};

export type WebhookValidationInput = {
  signature: string | null;
  urlCandidates: string[];
  payload: Record<string, string | string[]>;
};

export interface WhatsAppProvider {
  readonly providerName: WhatsAppProviderName;
  sendTextMessage(input: SendWhatsAppMessageInput): Promise<SendWhatsAppMessageResult>;
  validateWebhookSignature(input: WebhookValidationInput): boolean;
  parseInboundPayload(payload: unknown): ParsedInboundWhatsAppMessage[];
}
