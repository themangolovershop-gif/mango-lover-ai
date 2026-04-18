import crypto from 'node:crypto';
import type {
  SendWhatsAppMessageInput,
  SendWhatsAppMessageResult,
  ParsedInboundWhatsAppMessage,
  WhatsAppProvider,
  WebhookValidationInput,
} from '@/backend/modules/whatsapp/provider';
import { env } from '@/backend/config/env';
import { logger } from '@/backend/shared/lib/logger';
import { AppError } from '@/backend/shared/lib/errors/app-error';

interface MetaError {
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id: string;
  };
}

interface MetaMessageResponse {
  messages?: Array<{ id: string }>;
  error?: MetaError['error'];
}

export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly providerName = 'meta' as const;

  async sendTextMessage(input: SendWhatsAppMessageInput): Promise<SendWhatsAppMessageResult> {
    const { to, body } = input;

    // Use environment variables for Meta API
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';

    const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;
    
    const payload = {
      messaging_product: 'whatsapp',
      to: to.replace('+', ''),
      type: 'text',
      text: { body }
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json() as MetaMessageResponse;

      if (!response.ok) {
        throw new AppError({
          message: data.error?.message || 'Meta API request failed',
          code: 'META_SEND_FAILED',
          statusCode: 502,
          details: data.error
        });
      }

      return {
        providerMessageId: data.messages?.[0]?.id || null
      };
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('whatsapp.meta.outbound.failed', { error: errorMessage });
      throw new AppError({
        message: 'Internal error communicating with Meta API',
        code: 'META_PROVIDER_ERROR',
        statusCode: 500
      });
    }
  }

  validateWebhookSignature(input: WebhookValidationInput): boolean {
    const { signature, payload } = input;
    const appSecret = process.env.WHATSAPP_APP_SECRET || '';

    if (!signature) {
      return env.NODE_ENV === 'development';
    }

    const payloadString = JSON.stringify(payload);
    const expectedSignature = `sha256=${crypto
      .createHmac('sha256', appSecret)
      .update(payloadString)
      .digest('hex')}`;

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  parseInboundPayload(payload: unknown): ParsedInboundWhatsAppMessage[] {
    const data = payload as any; // Cast once to access nested fields safely in this context
    if (data.object !== 'whatsapp_business_account') return [];

    const messages: ParsedInboundWhatsAppMessage[] = [];

    for (const entry of data.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value || !value.messages) continue;

        for (const msg of value.messages) {
          const contact = value.contacts?.find((c: any) => c.wa_id === msg.from);
          
          messages.push({
            provider: this.providerName,
            providerMessageId: msg.id,
            from: `+${msg.from}`,
            profileName: contact?.profile?.name || null,
            body: msg.text?.body || null,
            rawPayload: msg,
            receivedAt: new Date(parseInt(msg.timestamp) * 1000)
          });
        }
      }
    }

    return messages;
  }
}
