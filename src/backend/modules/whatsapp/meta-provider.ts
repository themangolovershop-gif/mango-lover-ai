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
import { AppError, ValidationError } from '@/backend/shared/lib/errors/app-error';
import { withRetry } from '@/backend/shared/lib/http/retry';

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

function createAbortSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeoutHandle),
  };
}

async function parseMetaResponse(response: Response) {
  const rawBody = await response.text();

  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody) as MetaMessageResponse;
  } catch {
    return null;
  }
}

function isMetaRetryableStatus(statusCode: number) {
  return statusCode === 429 || statusCode >= 500;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function getErrorCode(error: unknown) {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : null;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function isRetryableTransportError(error: unknown) {
  if (isAbortError(error)) {
    return false;
  }

  const code = getErrorCode(error);
  const normalizedCode = typeof code === 'string' ? code.toUpperCase() : null;

  return (
    error instanceof TypeError ||
    (normalizedCode !== null &&
      ['ECONNABORTED', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT'].includes(normalizedCode))
  );
}

export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly providerName = 'meta' as const;

  async sendTextMessage(input: SendWhatsAppMessageInput): Promise<SendWhatsAppMessageResult> {
    const body = input.body.trim();

    if (!body) {
      throw new ValidationError('Outbound WhatsApp messages require a non-empty body.');
    }

    const accessToken = env.WHATSAPP_ACCESS_TOKEN!;
    const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID!;

    const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to: input.to.replace('+', ''),
      type: 'text',
      text: { body },
    };

    try {
      const result = await withRetry(
        async () => {
          const requestTimeout = createAbortSignal(env.WHATSAPP_REQUEST_TIMEOUT_MS);

          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payload),
              signal: requestTimeout.signal,
            });

            const data = await parseMetaResponse(response);

            if (!response.ok) {
              const providerError = data?.error;
              const statusCode = response.status;

              throw new AppError({
                message: providerError?.message || 'Meta API request failed',
                code: isMetaRetryableStatus(statusCode)
                  ? 'META_SEND_RETRYABLE'
                  : 'META_SEND_FAILED',
                statusCode: isMetaRetryableStatus(statusCode) ? 503 : 502,
                details: {
                  httpStatus: statusCode,
                  providerCode: providerError?.code,
                  providerType: providerError?.type,
                  traceId: providerError?.fbtrace_id,
                },
              });
            }

            logger.info('whatsapp.meta.outbound.sent', {
              to: input.to,
              providerMessageId: data?.messages?.[0]?.id ?? null,
            });

            return {
              providerMessageId: data?.messages?.[0]?.id ?? null,
            };
          } finally {
            requestTimeout.cancel();
          }
        },
        {
          operation: 'meta_send_message',
          maxAttempts: env.WHATSAPP_MAX_RETRIES,
          baseDelayMs: env.WHATSAPP_RETRY_BASE_DELAY_MS,
          classifyError: (error) => {
            if (error instanceof AppError && error.code === 'META_SEND_RETRYABLE') {
              return {
                retryable: true,
                reason: 'meta_http_retryable',
              };
            }

            if (isRetryableTransportError(error)) {
              return {
                retryable: true,
                reason: 'meta_transport_error',
              };
            }

            return {
              retryable: false,
            };
          },
          onRetry: ({ attempt, maxAttempts, nextDelayMs, reason, error }) => {
            logger.warn('whatsapp.meta.outbound.retrying', {
              attempt,
              maxAttempts,
              nextDelayMs,
              reason,
              errorMessage: getErrorMessage(error),
              errorCode: getErrorCode(error) ?? undefined,
            });
          },
        }
      );

      return result;
    } catch (error: unknown) {
      if (error instanceof AppError) {
        if (error.code === 'META_SEND_RETRYABLE') {
          throw new AppError({
            message: 'Meta API request failed after retries.',
            code: 'META_SEND_FAILED',
            statusCode: 502,
            details: error.details,
          });
        }

        throw error;
      }

      if (isAbortError(error)) {
        logger.error('whatsapp.meta.outbound.timeout', {
          to: input.to,
          timeoutMs: env.WHATSAPP_REQUEST_TIMEOUT_MS,
        });

        throw new AppError({
          message: 'Meta API request timed out before a delivery confirmation was received.',
          code: 'META_PROVIDER_TIMEOUT',
          statusCode: 504,
          details: {
            timeoutMs: env.WHATSAPP_REQUEST_TIMEOUT_MS,
          },
        });
      }

      throw new AppError({
        message: 'Internal error communicating with Meta API',
        code: 'META_PROVIDER_ERROR',
        statusCode: 500,
        details: {
          error: getErrorMessage(error),
        },
      });
    }
  }

  validateWebhookSignature(input: WebhookValidationInput): boolean {
    const { signature, payload } = input;
    const appSecret = env.WHATSAPP_APP_SECRET || '';

    if (!signature) {
      return env.NODE_ENV === 'development';
    }

    const payloadString = JSON.stringify(payload);
    const expectedSignature = `sha256=${crypto
      .createHmac('sha256', appSecret)
      .update(payloadString)
      .digest('hex')}`;
    const providedSignature = Buffer.from(signature);
    const expectedSignatureBuffer = Buffer.from(expectedSignature);

    if (providedSignature.length !== expectedSignatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      providedSignature,
      expectedSignatureBuffer
    );
  }

  parseInboundPayload(payload: unknown): ParsedInboundWhatsAppMessage[] {
    const data = payload as { object: string; entry: any[] };
    if (data.object !== 'whatsapp_business_account') return [];

    const messages: ParsedInboundWhatsAppMessage[] = [];

    for (const entry of data.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value || !value.messages) continue;

        for (const msg of value.messages) {
          const contact = value.contacts?.find((c: { wa_id: string }) => c.wa_id === msg.from);
          
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
