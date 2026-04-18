import { ConversationStatus, type BuyerType, type LeadStage, type LeadTemperature, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { NotFoundError } from '@/backend/shared/lib/errors/app-error';
import { validateWithSchema } from '@/backend/shared/lib/http/validation';
import { getPrismaClient } from '@/backend/shared/lib/prisma';

const leadListQuerySchema = z.object({
  stage: z
    .enum([
      'NEW_INQUIRY',
      'ENGAGED',
      'QUALIFIED',
      'AWAITING_DETAILS',
      'AWAITING_PAYMENT',
      'PAYMENT_SUBMITTED',
      'CONFIRMED',
      'COMPLAINT_OPEN',
      'ESCALATED',
      'COLD',
      'LOST',
    ])
    .optional() as z.ZodOptional<z.ZodType<LeadStage>>,
  temperature: z.enum(['COLD', 'WARM', 'HOT']).optional() as z.ZodOptional<z.ZodType<LeadTemperature>>,
  needsHuman: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const leadParamsSchema = z.object({
  id: z.string().min(1),
});

const leadUpdateBodySchema = z.object({
  stage: z
    .enum([
      'NEW_INQUIRY',
      'ENGAGED',
      'QUALIFIED',
      'AWAITING_DETAILS',
      'AWAITING_PAYMENT',
      'PAYMENT_SUBMITTED',
      'CONFIRMED',
      'COMPLAINT_OPEN',
      'ESCALATED',
      'COLD',
      'LOST',
    ])
    .optional() as z.ZodOptional<z.ZodType<LeadStage>>,
  buyerType: z.enum(['PERSONAL', 'GIFTING', 'BULK', 'REPEAT', 'UNCERTAIN']).optional() as z.ZodOptional<z.ZodType<BuyerType>>,
  score: z.coerce.number().int().min(0).max(100).optional(),
  temperature: z.enum(['COLD', 'WARM', 'HOT']).optional() as z.ZodOptional<z.ZodType<LeadTemperature>>,
  needsHuman: z.boolean().optional(),
  escalationReason: z.string().trim().max(500).nullable().optional(),
  tagsJson: z.record(z.any()).nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
});

export const leadsRouter = Router();

leadsRouter.get('/', async (request, response) => {
  const query = validateWithSchema(leadListQuerySchema, request.query);
  const prisma = getPrismaClient();

  const leads = await prisma.lead.findMany({
    where: {
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.temperature ? { temperature: query.temperature } : {}),
      ...(query.needsHuman !== undefined ? { needsHuman: query.needsHuman } : {}),
    },
    include: {
      customer: true,
      conversation: true,
      orders: {
        orderBy: {
          updatedAt: 'desc',
        },
        take: 1,
      },
      escalations: {
        where: {
          status: {
            in: ['OPEN', 'IN_REVIEW'],
          },
        },
      },
    },
    orderBy: [{ needsHuman: 'desc' }, { updatedAt: 'desc' }],
    take: query.limit,
  });

  response.status(200).json({
    success: true,
    data: leads,
  });
});

leadsRouter.get('/:id', async (request, response) => {
  const params = validateWithSchema(leadParamsSchema, request.params);
  const prisma = getPrismaClient();

  const lead = await prisma.lead.findUnique({
    where: {
      id: params.id,
    },
    include: {
      customer: true,
      conversation: true,
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
    },
  });

  if (!lead) {
    throw new NotFoundError(`Lead ${params.id} was not found.`);
  }

  response.status(200).json({
    success: true,
    data: lead,
  });
});

leadsRouter.patch('/:id', async (request, response) => {
  const params = validateWithSchema(leadParamsSchema, request.params);
  const body = validateWithSchema(leadUpdateBodySchema, request.body);
  const prisma = getPrismaClient();

  const lead = await prisma.lead.findUnique({
    where: {
      id: params.id,
    },
    select: {
      id: true,
      conversationId: true,
    },
  });

  if (!lead) {
    throw new NotFoundError(`Lead ${params.id} was not found.`);
  }

  const updatedLead = await prisma.$transaction(async (tx) => {
    const nextFollowUpAt =
      body.nextFollowUpAt !== undefined
        ? body.nextFollowUpAt === null
          ? null
          : new Date(body.nextFollowUpAt)
        : undefined;

    const updated = await tx.lead.update({
      where: {
        id: params.id,
      },
      data: {
        ...(body.stage ? { stage: body.stage } : {}),
        ...(body.buyerType ? { buyerType: body.buyerType } : {}),
        ...(body.score !== undefined ? { score: body.score } : {}),
        ...(body.temperature ? { temperature: body.temperature } : {}),
        ...(body.needsHuman !== undefined ? { needsHuman: body.needsHuman } : {}),
        ...(body.escalationReason !== undefined
          ? { escalationReason: body.escalationReason }
          : {}),
        ...(body.tagsJson !== undefined
          ? { tagsJson: body.tagsJson === null ? Prisma.JsonNull : body.tagsJson }
          : {}),
        ...(nextFollowUpAt !== undefined ? { nextFollowUpAt } : {}),
      },
    });

    if (body.stage || body.needsHuman !== undefined) {
      await tx.conversation.update({
        where: {
          id: lead.conversationId,
        },
        data: {
          ...(body.stage ? { currentStage: body.stage } : {}),
          ...(body.needsHuman !== undefined
            ? {
                status: body.needsHuman
                  ? ConversationStatus.PENDING_HUMAN
                  : ConversationStatus.OPEN,
              }
            : {}),
        },
      });
    }

    return updated;
  });

  response.status(200).json({
    success: true,
    data: updatedLead,
  });
});
