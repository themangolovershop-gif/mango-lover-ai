import { EscalationSeverity, EscalationStatus, EscalationType } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import {
  getEscalationById,
  listEscalations,
  updateEscalation,
} from '@/backend/modules/escalations/escalation.service';
import { validateWithSchema } from '@/backend/shared/lib/http/validation';

const escalationParamsSchema = z.object({
  id: z.string().min(1),
});

const escalationListQuerySchema = z.object({
  leadId: z.string().trim().optional(),
  conversationId: z.string().trim().optional(),
  customerId: z.string().trim().optional(),
  status: z
    .enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'])
    .optional() as z.ZodOptional<z.ZodType<EscalationStatus>>,
  severity: z
    .enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
    .optional() as z.ZodOptional<z.ZodType<EscalationSeverity>>,
  type: z
    .enum([
      'COMPLAINT',
      'BULK_ORDER',
      'REFUND_REQUEST',
      'PAYMENT_CONFLICT',
      'LOW_CONFIDENCE',
      'HIGH_RISK_LOGISTICS',
    ])
    .optional() as z.ZodOptional<z.ZodType<EscalationType>>,
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const escalationUpdateBodySchema = z.object({
  type: z
    .enum([
      'COMPLAINT',
      'BULK_ORDER',
      'REFUND_REQUEST',
      'PAYMENT_CONFLICT',
      'LOW_CONFIDENCE',
      'HIGH_RISK_LOGISTICS',
    ])
    .optional() as z.ZodOptional<z.ZodType<EscalationType>>,
  severity: z
    .enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
    .optional() as z.ZodOptional<z.ZodType<EscalationSeverity>>,
  status: z
    .enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'])
    .optional() as z.ZodOptional<z.ZodType<EscalationStatus>>,
  reason: z.string().trim().max(500).optional(),
  resolutionNotes: z.string().trim().max(1000).nullable().optional(),
  assignedTo: z.string().trim().max(255).nullable().optional(),
});

export const escalationsRouter = Router();

escalationsRouter.get('/', async (request, response) => {
  const query = validateWithSchema(escalationListQuerySchema, request.query);
  const escalations = await listEscalations(query);

  response.status(200).json({
    success: true,
    data: escalations,
  });
});

escalationsRouter.get('/:id', async (request, response) => {
  const params = validateWithSchema(escalationParamsSchema, request.params);
  const escalation = await getEscalationById(params.id);

  response.status(200).json({
    success: true,
    data: escalation,
  });
});

escalationsRouter.patch('/:id', async (request, response) => {
  const params = validateWithSchema(escalationParamsSchema, request.params);
  const body = validateWithSchema(escalationUpdateBodySchema, request.body);
  const escalation = await updateEscalation(params.id, body);

  response.status(200).json({
    success: true,
    data: escalation,
  });
});
