import { MessageSender, type FollowUpStatus, type FollowUpType } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import {
  cancelFollowUp,
  getFollowUpById,
  listFollowUps,
  markFollowUpFailed,
  markFollowUpSent,
  updateFollowUp,
} from '@/backend/modules/followups/follow-up.service';
import { optimizationTelemetryService } from '@/backend/modules/optimization/telemetry.service';
import { sendOutboundWhatsAppMessage } from '@/backend/modules/whatsapp/outbound.service';
import { ValidationError } from '@/backend/shared/lib/errors/app-error';
import { validateWithSchema } from '@/backend/shared/lib/http/validation';
import { getPrismaClient } from '@/backend/shared/lib/prisma';

const followUpParamsSchema = z.object({
  id: z.string().min(1),
});

const followUpListQuerySchema = z.object({
  leadId: z.string().trim().optional(),
  conversationId: z.string().trim().optional(),
  status: z
    .enum(['PENDING', 'SENT', 'CANCELLED', 'FAILED'])
    .optional() as z.ZodOptional<z.ZodType<FollowUpStatus>>,
  type: z
    .enum(['NO_RESPONSE', 'PAYMENT_PENDING', 'DETAILS_PENDING', 'REPEAT_REACTIVATION'])
    .optional() as z.ZodOptional<z.ZodType<FollowUpType>>,
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const followUpUpdateBodySchema = z.object({
  action: z.enum(['update', 'cancel', 'fail']).default('update'),
  type: z
    .enum(['NO_RESPONSE', 'PAYMENT_PENDING', 'DETAILS_PENDING', 'REPEAT_REACTIVATION'])
    .optional() as z.ZodOptional<z.ZodType<FollowUpType>>,
  reason: z.string().trim().max(500).optional(),
  suggestedMessage: z.string().trim().max(2000).nullable().optional(),
  scheduledAt: z.string().datetime().optional(),
  result: z.string().trim().max(1000).nullable().optional(),
});

const followUpSendBodySchema = z.object({
  body: z.string().trim().min(1).max(2000).optional(),
  sentBy: z.enum(['HUMAN', 'SYSTEM']).default('SYSTEM'),
  result: z.string().trim().max(1000).nullable().optional(),
});

export const followUpsRouter = Router();

followUpsRouter.get('/', async (request, response) => {
  const query = validateWithSchema(followUpListQuerySchema, request.query);
  const followUps = await listFollowUps(query);

  response.status(200).json({
    success: true,
    data: followUps,
  });
});

followUpsRouter.patch('/:id', async (request, response) => {
  const params = validateWithSchema(followUpParamsSchema, request.params);
  const body = validateWithSchema(followUpUpdateBodySchema, request.body);

  const followUp =
    body.action === 'cancel'
      ? await cancelFollowUp(params.id, body.result ?? null)
      : body.action === 'fail'
        ? await markFollowUpFailed(params.id, body.result ?? 'Follow-up delivery failed.')
        : await updateFollowUp(params.id, {
            ...(body.type ? { type: body.type } : {}),
            ...(body.reason ? { reason: body.reason } : {}),
            ...(body.suggestedMessage !== undefined ? { suggestedMessage: body.suggestedMessage } : {}),
            ...(body.scheduledAt ? { scheduledAt: body.scheduledAt } : {}),
            ...(body.result !== undefined ? { result: body.result } : {}),
          });

  response.status(200).json({
    success: true,
    data: followUp,
  });
});

followUpsRouter.post('/:id/send', async (request, response) => {
  const params = validateWithSchema(followUpParamsSchema, request.params);
  const body = validateWithSchema(followUpSendBodySchema, request.body);
  const prisma = getPrismaClient();

  const followUp = await getFollowUpById(params.id);
  const conversation = await prisma.conversation.findUnique({
    where: {
      id: followUp.conversationId,
    },
    select: {
      id: true,
      customerId: true,
      lead: {
        select: {
          id: true,
        },
      },
    },
  });

  const outboundBody = body.body ?? followUp.suggestedMessage ?? undefined;

  if (!outboundBody) {
    throw new ValidationError('Follow-up message body is required when no suggested message is stored.');
  }

  const outbound = await sendOutboundWhatsAppMessage({
    conversationId: followUp.conversationId,
    body: outboundBody,
    sentBy: body.sentBy === 'HUMAN' ? MessageSender.HUMAN : MessageSender.SYSTEM,
  });

  const updatedFollowUp = await markFollowUpSent(
    params.id,
    body.result ?? `Sent manually via admin API. Provider message id: ${outbound.providerMessageId ?? 'n/a'}.`
  );

  await prisma.analyticsEvent.create({
    data: {
      customerId: conversation?.customerId ?? null,
      conversationId: followUp.conversationId,
      leadId: conversation?.lead?.id ?? followUp.leadId,
      eventType: 'follow_up_sent',
      payloadJson: {
        followUpId: followUp.id,
        providerMessageId: outbound.providerMessageId,
      },
    },
  });

  if (body.sentBy === 'HUMAN') {
    await optimizationTelemetryService.recordHumanFeedback({
      conversationId: followUp.conversationId,
      customerId: conversation?.customerId ?? null,
      messageId: outbound.message.id,
      aiSuggestionType: 'follow_up_send',
      aiSuggestedReply: followUp.suggestedMessage,
      humanFinalReply: outboundBody,
      correctionType: 'REPLY_REWRITE',
      reason: 'A human edited and sent the follow-up manually.',
      metadata: {
        followUpId: followUp.id,
        leadId: conversation?.lead?.id ?? followUp.leadId,
      },
    });
  }

  response.status(200).json({
    success: true,
    data: updatedFollowUp,
  });
});
