import { FulfillmentStatus, OrderStatus, PaymentStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { getPaymentById, updatePayment } from '@/backend/modules/payments/payment.service';
import { getOrderById, listOrders, updateOrder } from '@/backend/modules/orders/order.service';
import { NotFoundError } from '@/backend/shared/lib/errors/app-error';
import { validateWithSchema } from '@/backend/shared/lib/http/validation';

const orderParamsSchema = z.object({
  id: z.string().min(1),
});

const orderListQuerySchema = z.object({
  customerId: z.string().trim().optional(),
  conversationId: z.string().trim().optional(),
  leadId: z.string().trim().optional(),
  status: z
    .enum([
      'DRAFT',
      'PENDING_DETAILS',
      'PENDING_PAYMENT',
      'PAYMENT_UNDER_REVIEW',
      'CONFIRMED',
      'PACKED',
      'DISPATCHED',
      'DELIVERED',
      'CANCELLED',
      'REFUND_REQUESTED',
      'REFUNDED',
      'ON_HOLD',
    ])
    .optional() as z.ZodOptional<z.ZodType<OrderStatus>>,
  paymentStatus: z
    .enum(['UNPAID', 'SUBMITTED', 'VERIFIED', 'FAILED', 'PARTIAL', 'REFUNDED'])
    .optional() as z.ZodOptional<z.ZodType<PaymentStatus>>,
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const orderItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.union([z.string(), z.number()]).optional(),
  metadataJson: z.record(z.any()).optional(),
});

const updateOrderBodySchema = z.object({
  items: z.array(orderItemSchema).min(1).optional(),
  deliveryCharge: z.union([z.string(), z.number()]).optional(),
  discountAmount: z.union([z.string(), z.number()]).optional(),
  currency: z.string().trim().length(3).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  paymentReference: z.string().trim().max(255).nullable().optional(),
  status: z
    .enum([
      'DRAFT',
      'PENDING_DETAILS',
      'PENDING_PAYMENT',
      'PAYMENT_UNDER_REVIEW',
      'CONFIRMED',
      'PACKED',
      'DISPATCHED',
      'DELIVERED',
      'CANCELLED',
      'REFUND_REQUESTED',
      'REFUNDED',
      'ON_HOLD',
    ])
    .optional() as z.ZodOptional<z.ZodType<OrderStatus>>,
  paymentStatus: z
    .enum(['UNPAID', 'SUBMITTED', 'VERIFIED', 'FAILED', 'PARTIAL', 'REFUNDED'])
    .optional() as z.ZodOptional<z.ZodType<PaymentStatus>>,
  fulfillmentStatus: z
    .enum(['NOT_STARTED', 'PREPARING', 'PACKED', 'SHIPPED', 'DELIVERED'])
    .optional() as z.ZodOptional<z.ZodType<FulfillmentStatus>>,
});

const verifyPaymentBodySchema = z.object({
  paymentId: z.string().min(1),
  verifiedBy: z.string().trim().max(255).nullable().optional(),
});

export const ordersRouter = Router();

ordersRouter.get('/', async (request, response) => {
  const query = validateWithSchema(orderListQuerySchema, request.query);

  const orders = await listOrders(query);

  response.status(200).json({
    success: true,
    data: orders,
  });
});

ordersRouter.get('/:id', async (request, response) => {
  const params = validateWithSchema(orderParamsSchema, request.params);
  const order = await getOrderById(params.id);

  response.status(200).json({
    success: true,
    data: order,
  });
});

ordersRouter.patch('/:id', async (request, response) => {
  const params = validateWithSchema(orderParamsSchema, request.params);
  const body = validateWithSchema(updateOrderBodySchema, request.body);

  const order = await updateOrder(params.id, body);

  response.status(200).json({
    success: true,
    data: order,
  });
});

ordersRouter.post('/:id/verify-payment', async (request, response) => {
  const params = validateWithSchema(orderParamsSchema, request.params);
  const body = validateWithSchema(verifyPaymentBodySchema, request.body);

  const payment = await getPaymentById(body.paymentId);

  if (payment.orderId !== params.id) {
    throw new NotFoundError(`Payment ${body.paymentId} does not belong to order ${params.id}.`);
  }

  const result = await updatePayment(body.paymentId, {
    status: PaymentStatus.VERIFIED,
    verifiedBy: body.verifiedBy ?? null,
  });

  response.status(200).json({
    success: true,
    data: result,
  });
});
