import crypto from 'node:crypto';

import type {
  SendWhatsAppMessageInput,
  SendWhatsAppMessageResult,
  ParsedInboundWhatsAppMessage,
  WhatsAppProvider,
} from '@/backend/modules/whatsapp/provider';
import { env } from '@/backend/config/env';
import {
  AppError,
  NotImplementedError,
  ValidationError,
} from '@/backend/shared/lib/errors/app-error';
import { logger } from '@/backend/shared/lib/logger';

function normalizeFormValue(value: unknown): string | string[] | null {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return null;
}

function toFlatFormPayload(payload: unknown): Record<string, string | string[]> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }

  const entries = Object.entries(payload as Record<string, unknown>);
  const normalizedEntries = entries.flatMap(([key, value]) => {
    const normalizedValue = normalizeFormValue(value);

    return normalizedValue === null ? [] : ([[key, normalizedValue]] as const);
  });

  return Object.fromEntries(normalizedEntries);
}

function normalizePhoneNumber(value: string): string {
  const withoutPrefix = value.trim().replace(/^whatsapp:/i, '');
  return withoutPrefix.startsWith('+') ? withoutPrefix : `+${withoutPrefix}`;
}

function toTwilioWhatsappAddress(phoneNumber: string): string {
  return `whatsapp:${normalizePhoneNumber(phoneNumber)}`;
}

function appendSignatureValue(prefix: string, key: string, value: string | string[]) {
  if (Array.isArray(value)) {
    return value.reduce((buffer, entry) => `${buffer}${key}${entry}`, prefix);
  }

  return `${prefix}${key}${value}`;
}

function buildExpectedSignature(url: string, payload: Record<string, string | string[]>) {
  const signaturePayload = Object.keys(payload)
    .sort((left, right) => left.localeCompare(right))
    .reduce((buffer, key) => appendSignatureValue(buffer, key, payload[key]!), url);

  return crypto
    .createHmac('sha1', env.TWILIO_AUTH_TOKEN!)
    .update(signaturePayload, 'utf8')
    .digest('base64');
}

function timingSafeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export class TwilioWhatsAppProvider implements WhatsAppProvider {
  readonly providerName = 'twilio' as const;

  async sendTextMessage(
    input: SendWhatsAppMessageInput
  ): Promise<SendWhatsAppMessageResult> {
    if (input.buttons?.length) {
      throw new NotImplementedError(
        'Twilio text sending does not support interactive buttons in Phase B.'
      );
    }

    const body = input.body.trim();

    if (!body) {
      throw new ValidationError('Outbound WhatsApp messages require a non-empty body.');
    }

    const requestBody = new URLSearchParams({
      From: toTwilioWhatsappAddress(env.TWILIO_WHATSAPP_NUMBER!),
      To: toTwilioWhatsappAddress(input.to),
      Body: body,
    });

    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const authorization = Buffer.from(
      `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`
    ).toString('base64');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authorization}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: requestBody,
    });

    const data = (await response.json().catch(() => null)) as
      | {
          sid?: string;
          message?: string;
          code?: number;
        }
      | null;

    if (!response.ok) {
      throw new AppError({
        message: data?.message || 'Twilio message send failed.',
        code: 'TWILIO_SEND_FAILED',
        statusCode: 502,
        details: {
          httpStatus: response.status,
          providerCode: data?.code,
        },
      });
    }

    logger.info('whatsapp.twilio.outbound.sent', {
      to: normalizePhoneNumber(input.to),
      providerMessageId: data?.sid ?? null,
    });

    return {
      providerMessageId: data?.sid ?? null,
    };
  }

  validateWebhookSignature(input: {
    signature: string | null;
    urlCandidates: string[];
    payload: Record<string, string | string[]>;
  }) {
    if (!input.signature) {
      if (env.NODE_ENV === 'development') {
        logger.warn('whatsapp.twilio.signature.skipped', {
          reason: 'missing_signature_header',
        });
        return true;
      }

      return false;
    }

    return input.urlCandidates.some((urlCandidate) =>
      timingSafeEqual(input.signature!, buildExpectedSignature(urlCandidate, input.payload))
    );
  }

  parseInboundPayload(payload: unknown): ParsedInboundWhatsAppMessage[] {
    const formPayload = toFlatFormPayload(payload);
    const providerMessageId = formPayload.MessageSid;
    const from = formPayload.From;

    if (typeof providerMessageId !== 'string' || typeof from !== 'string') {
      return [];
    }

    return [
      {
        provider: this.providerName,
        providerMessageId,
        from: normalizePhoneNumber(from),
        profileName: typeof formPayload.ProfileName === 'string' ? formPayload.ProfileName : null,
        body: typeof formPayload.Body === 'string' ? formPayload.Body.trim() : null,
        rawPayload: formPayload,
        receivedAt: new Date(),
      },
    ];
  }
}

import { MetaWhatsAppProvider } from './meta-provider';

export function getConfiguredWhatsAppProvider(): WhatsAppProvider {
  const provider = env.WHATSAPP_PROVIDER;
  console.log('[DEBUG] WHATSAPP_PROVIDER value:', `|${provider}|`, 'length:', provider.length);

  if (provider === 'twilio') {
    return new TwilioWhatsAppProvider();
  }

  if (provider === 'meta') {
    return new MetaWhatsAppProvider();
  }

  throw new NotImplementedError(
    `WHATSAPP_PROVIDER=${provider} is not implemented yet.`
  );
}
