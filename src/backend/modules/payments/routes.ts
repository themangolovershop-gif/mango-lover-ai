import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import {
  createPayment,
  getPaymentById,
  listPayments,
  updatePayment,
} from '@/backend/modules/payments/payment.service';
import { validateWithSchema } from '@/backend/shared/lib/http/validation';

const paymentParamsSchema = z.object({
  id: z.string().min(1),
});

const paymentListQuerySchema = z.object({
  orderId: z.string().trim().optional(),
  status: z
    .enum(['UNPAID', 'SUBMITTED', 'VERIFIED', 'FAILED', 'PARTIAL', 'REFUNDED'])
    .optional() as z.ZodOptional<z.ZodType<PaymentStatus>>,
  method: z
    .enum(['UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'OTHER'])
    .optional() as z.ZodOptional<z.ZodType<PaymentMethod>>,
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const createPaymentBodySchema = z.object({
  orderId: z.string().min(1),
  amount: z.union([z.string(), z.number()]),
  method: z.enum(['UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'OTHER']) as z.ZodType<PaymentMethod>,
  status: z
    .enum(['UNPAID', 'SUBMITTED', 'VERIFIED', 'FAILED', 'PARTIAL', 'REFUNDED'])
    .optional() as z.ZodOptional<z.ZodType<PaymentStatus>>,
  reference: z.string().trim().max(255).nullable().optional(),
  screenshotUrl: z.string().trim().url().nullable().optional(),
  verifiedBy: z.string().trim().max(255).nullable().optional(),
  paidAt: z.string().datetime().nullable().optional(),
});

const updatePaymentBodySchema = z.object({
  status: z
    .enum(['UNPAID', 'SUBMITTED', 'VERIFIED', 'FAILED', 'PARTIAL', 'REFUNDED'])
    .optional() as z.ZodOptional<z.ZodType<PaymentStatus>>,
  reference: z.string().trim().max(255).nullable().optional(),
  screenshotUrl: z.string().trim().url().nullable().optional(),
  verifiedBy: z.string().trim().max(255).nullable().optional(),
  paidAt: z.string().datetime().nullable().optional(),
});

export const paymentsRouter = Router();

paymentsRouter.get('/', async (request, response) => {
  const query = validateWithSchema(paymentListQuerySchema, request.query);
  const payments = await listPayments(query);

  response.status(200).json({
    success: true,
    data: payments,
  });
});

paymentsRouter.get('/:id', async (request, response) => {
  const params = validateWithSchema(paymentParamsSchema, request.params);
  const payment = await getPaymentById(params.id);

  response.status(200).json({
    success: true,
    data: payment,
  });
});

paymentsRouter.post('/', async (request, response) => {
  const body = validateWithSchema(createPaymentBodySchema, request.body);
  const result = await createPayment(body);

  response.status(201).json({
    success: true,
    data: result,
  });
});

paymentsRouter.patch('/:id', async (request, response) => {
  const params = validateWithSchema(paymentParamsSchema, request.params);
  const body = validateWithSchema(updatePaymentBodySchema, request.body);
  const result = await updatePayment(params.id, body);

  response.status(200).json({
    success: true,
    data: result,
  });
});
