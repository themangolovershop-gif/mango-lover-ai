import { Router } from 'express';
import { z } from 'zod';

import { NotFoundError } from '@/backend/shared/lib/errors/app-error';
import { validateWithSchema } from '@/backend/shared/lib/http/validation';
import { getPrismaClient } from '@/backend/shared/lib/prisma';

const customerListQuerySchema = z.object({
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const customerParamsSchema = z.object({
  id: z.string().min(1),
});

export const customersRouter = Router();

customersRouter.get('/', async (request, response) => {
  const query = validateWithSchema(customerListQuerySchema, request.query);
  const prisma = getPrismaClient();

  const customers = await prisma.customer.findMany({
    where: query.search
      ? {
          OR: [
            {
              name: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
            {
              phone: {
                contains: query.search,
              },
            },
            {
              city: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
          ],
        }
      : undefined,
    include: {
      _count: {
        select: {
          conversations: true,
          leads: true,
          orders: true,
          escalations: true,
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
    data: customers,
  });
});

customersRouter.get('/:id', async (request, response) => {
  const params = validateWithSchema(customerParamsSchema, request.params);
  const prisma = getPrismaClient();

  const customer = await prisma.customer.findUnique({
    where: {
      id: params.id,
    },
    include: {
      addresses: true,
      conversations: {
        include: {
          lead: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
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
      escalations: {
        orderBy: {
          createdAt: 'desc',
        },
      },
    },
  });

  if (!customer) {
    throw new NotFoundError(`Customer ${params.id} was not found.`);
  }

  response.status(200).json({
    success: true,
    data: customer,
  });
});
