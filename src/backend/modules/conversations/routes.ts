import { MessageSender, type ConversationStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { cancelPendingFollowUpsForConversation } from '@/backend/modules/followups/follow-up.service';
import { optimizationTelemetryService } from '@/backend/modules/optimization/telemetry.service';
import { sendOutboundWhatsAppMessage } from '@/backend/modules/whatsapp/outbound.service';
import { NotFoundError } from '@/backend/shared/lib/errors/app-error';
import { validateWithSchema } from '@/backend/shared/lib/http/validation';
import { getPrismaClient } from '@/backend/shared/lib/prisma';

const conversationListQuerySchema = z.object({
  status: z
    .enum(['OPEN', 'PENDING_HUMAN', 'RESOLVED', 'CLOSED'])
    .optional() as z.ZodOptional<z.ZodType<ConversationStatus>>,
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const conversationParamsSchema = z.object({
  id: z.string().min(1),
});

const manualSendBodySchema = z.object({
  body: z.string().trim().min(1).max(2000),
  sentBy: z.enum(['HUMAN', 'SYSTEM']).default('HUMAN'),
});

export const conversationsRouter = Router();

conversationsRouter.get('/', async (request, response) => {
  const query = validateWithSchema(conversationListQuerySchema, request.query);
  const prisma = getPrismaClient();

  const conversations = await prisma.conversation.findMany({
    where: {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              {
                customer: {
                  name: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                customer: {
                  phone: {
                    contains: query.search,
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      customer: true,
      lead: true,
      messages: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
      orders: {
        orderBy: {
          updatedAt: 'desc',
        },
        take: 1,
      },
      followUps: {
        where: {
          status: 'PENDING',
        },
        orderBy: {
          scheduledAt: 'asc',
        },
      },
      escalations: {
        where: {
          status: {
            in: ['OPEN', 'IN_REVIEW'],
          },
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: query.limit,
  });

  response.status(200).json({
    success: true,
    data: conversations,
  });
});

conversationsRouter.get('/:id', async (request, response) => {
  const params = validateWithSchema(conversationParamsSchema, request.params);
  const prisma = getPrismaClient();

  const conversation = await prisma.conversation.findUnique({
    where: {
      id: params.id,
    },
    include: {
      customer: {
        include: {
          addresses: true,
          memory: true,
        },
      },
      lead: true,
      messages: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 50,
      },
      orders: {
        include: {
          items: {
            include: {
              product: true,
            },
          },
          payments: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      },
      followUps: {
        orderBy: {
          scheduledAt: 'asc',
        },
      },
      escalations: {
        orderBy: {
          createdAt: 'desc',
        },
      },
      sessionMemory: true,
    },
  });

  if (!conversation) {
    throw new NotFoundError(`Conversation ${params.id} was not found.`);
  }

  response.status(200).json({
    success: true,
    data: conversation,
  });
});

conversationsRouter.post('/:id/send', async (request, response) => {
  const params = validateWithSchema(conversationParamsSchema, request.params);
  const body = validateWithSchema(manualSendBodySchema, request.body);
  const prisma = getPrismaClient();

  const conversation = await prisma.conversation.findUnique({
    where: {
      id: params.id,
    },
    select: {
      id: true,
      customerId: true,
      lead: {
        select: {
          id: true,
        },
      },
      messages: {
        where: {
          direction: 'OUTBOUND',
          sentBy: 'AI',
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
        select: {
          id: true,
          rawText: true,
        },
      },
    },
  });

  if (!conversation) {
    throw new NotFoundError(`Conversation ${params.id} was not found.`);
  }

  await cancelPendingFollowUpsForConversation(
    conversation.id,
    'Cancelled because a manual outbound message was sent.'
  );

  const outbound = await sendOutboundWhatsAppMessage({
    conversationId: conversation.id,
    body: body.body,
    sentBy: body.sentBy === 'SYSTEM' ? MessageSender.SYSTEM : MessageSender.HUMAN,
  });

  if (body.sentBy === 'HUMAN') {
    await optimizationTelemetryService.recordHumanFeedback({
      conversationId: conversation.id,
      customerId: conversation.customerId,
      messageId: outbound.message.id,
      aiSuggestionType: 'manual_outbound_message',
      aiSuggestedReply: conversation.messages[0]?.rawText ?? null,
      humanFinalReply: body.body,
      correctionType: 'HUMAN_TAKEOVER',
      reason: 'A human operator sent a manual outbound reply.',
      metadata: {
        leadId: conversation.lead?.id ?? null,
      },
    });
  }

  await prisma.analyticsEvent.create({
    data: {
      customerId: conversation.customerId,
      conversationId: conversation.id,
      leadId: conversation.lead?.id ?? null,
      eventType: 'manual_outbound_message',
      payloadJson: {
        sentBy: body.sentBy,
        providerMessageId: outbound.providerMessageId,
      },
    },
  });

  response.status(200).json({
    success: true,
    data: {
      messageId: outbound.message.id,
      providerMessageId: outbound.providerMessageId,
    },
  });
});
