import type { NextFunction, Request, Response } from 'express';

import { env } from '@/backend/config/env';
import { processInboundWhatsAppMessage } from '@/backend/modules/whatsapp/message-orchestrator.service';
import { getConfiguredWhatsAppProvider } from '@/backend/modules/whatsapp/twilio-provider';
import { ValidationError } from '@/backend/shared/lib/errors/app-error';
import { logger } from '@/backend/shared/lib/logger';

function buildWebhookUrlCandidates(request: Request) {
  const requestHost = request.get('host');
  const requestOrigin =
    requestHost !== undefined ? `${request.protocol}://${requestHost}` : env.APP_BASE_URL;

  return Array.from(
    new Set([
      new URL(request.originalUrl, requestOrigin).toString(),
      new URL(request.originalUrl, env.APP_BASE_URL).toString(),
    ])
  );
}

export async function handleInboundWhatsAppWebhook(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const provider = getConfiguredWhatsAppProvider();
    const signature =
      request.get('x-twilio-signature') ?? request.get('X-Twilio-Signature') ?? null;
    const isValidSignature = provider.validateWebhookSignature({
      signature,
      urlCandidates: buildWebhookUrlCandidates(request),
      payload:
        request.body && typeof request.body === 'object'
          ? (request.body as Record<string, string | string[]>)
          : {},
    });

    if (!isValidSignature) {
      logger.warn('whatsapp.webhook.rejected', {
        provider: provider.providerName,
        reason: 'invalid_signature',
      });

      throw new ValidationError('Invalid WhatsApp webhook signature.');
    }

    const inboundMessages = provider.parseInboundPayload(request.body);

    if (inboundMessages.length === 0) {
      response.status(200).json({
        success: true,
        data: {
          status: 'ignored',
          provider: provider.providerName,
          reason: 'no_supported_messages',
        },
      });
      return;
    }

    const results = [];

    for (const inboundMessage of inboundMessages) {
      results.push(await processInboundWhatsAppMessage(inboundMessage));
    }

    response.status(200).json({
      success: true,
      data: {
        status: 'accepted',
        provider: provider.providerName,
        results,
      },
    });
  } catch (error) {
    next(error);
  }
}
