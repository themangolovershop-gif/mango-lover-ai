import { Router } from 'express';
import { z } from 'zod';

import { validateWithSchema } from '@/backend/shared/lib/http/validation';
import { getPrismaClient } from '@/backend/shared/lib/prisma';

const messageListQuerySchema = z.object({
  conversationId: z.string().trim().optional(),
  direction: z.enum(['INBOUND', 'OUTBOUND']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const messagesRouter = Router();

messagesRouter.get('/', async (request, response) => {
  const query = validateWithSchema(messageListQuerySchema, request.query);
  const prisma = getPrismaClient();

  const messages = await prisma.message.findMany({
    where: {
      ...(query.conversationId ? { conversationId: query.conversationId } : {}),
      ...(query.direction ? { direction: query.direction } : {}),
    },
    include: {
      conversation: {
        include: {
          customer: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: query.limit,
  });

  response.status(200).json({
    success: true,
    data: messages,
  });
});
