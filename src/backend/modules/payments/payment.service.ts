import { OrderStatus, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';

import { toDecimal, type DecimalInput } from '@/backend/modules/orders/order-calculations';
import {
  deriveAggregatePaymentStatus,
  deriveOrderStatusFromPaymentStatus,
} from '@/backend/modules/payments/payment-status';
import { NotFoundError, ValidationError } from '@/backend/shared/lib/errors/app-error';
import { getPrismaClient } from '@/backend/shared/lib/prisma';

type DateInput = Date | string;

export type CreatePaymentInput = {
  orderId: string;
  amount: DecimalInput;
  method: PaymentMethod;
  status?: PaymentStatus;
  reference?: string | null;
  screenshotUrl?: string | null;
  verifiedBy?: string | null;
  paidAt?: DateInput | null;
};

export type UpdatePaymentInput = {
  status?: PaymentStatus;
  reference?: string | null;
  screenshotUrl?: string | null;
  verifiedBy?: string | null;
  paidAt?: DateInput | null;
};

export type ListPaymentsFilters = {
  orderId?: string;
  status?: PaymentStatus;
  method?: PaymentMethod;
  limit?: number;
};

function hasOwnProperty<T extends object>(value: T, key: keyof T) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizePaymentAmount(amount: DecimalInput) {
  const decimal = toDecimal(amount, 'payment.amount').toDecimalPlaces(2);

  if (decimal.lessThanOrEqualTo(0)) {
    throw new ValidationError('Payment amount must be greater than zero.');
  }

  return decimal;
}

function normalizeOptionalDate(value: DateInput | null | undefined, fieldName: string) {
  if (value === null || value === undefined) {
    return value;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${fieldName} must be a valid date.`);
  }

  return date;
}

function buildPaymentWhere(filters: ListPaymentsFilters): Prisma.PaymentWhereInput {
  return {
    ...(filters.orderId ? { orderId: filters.orderId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.method ? { method: filters.method } : {}),
  };
}

async function syncOrderPaymentStateTx(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUnique({
    where: {
      id: orderId,
    },
    select: {
      id: true,
      totalAmount: true,
      status: true,
    },
  });

  if (!order) {
    throw new NotFoundError(`Order ${orderId} was not found.`);
  }

  const payments = await tx.payment.findMany({
    where: {
      orderId,
    },
    select: {
      amount: true,
      status: true,
    },
  });

  const paymentStatus = deriveAggregatePaymentStatus(order.totalAmount, payments);
  const orderStatus = deriveOrderStatusFromPaymentStatus(order.status, paymentStatus);

  return tx.order.update({
    where: {
      id: orderId,
    },
    data: {
      paymentStatus,
      status: orderStatus,
    },
  });
}

export async function listPayments(filters: ListPaymentsFilters = {}) {
  const prisma = getPrismaClient();

  return prisma.payment.findMany({
    where: buildPaymentWhere(filters),
    orderBy: {
      createdAt: 'desc',
    },
    take: filters.limit ?? 100,
  });
}

export async function getPaymentById(paymentId: string) {
  const prisma = getPrismaClient();
  const payment = await prisma.payment.findUnique({
    where: {
      id: paymentId,
    },
  });

  if (!payment) {
    throw new NotFoundError(`Payment ${paymentId} was not found.`);
  }

  return payment;
}

export async function syncOrderPaymentState(orderId: string) {
  const prisma = getPrismaClient();
  return prisma.$transaction((tx) => syncOrderPaymentStateTx(tx, orderId));
}

export async function createPayment(input: CreatePaymentInput) {
  const prisma = getPrismaClient();
  const paidAt = normalizeOptionalDate(input.paidAt, 'paidAt');
  const paymentStatus = input.status ?? PaymentStatus.SUBMITTED;

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        orderId: input.orderId,
        amount: normalizePaymentAmount(input.amount),
        method: input.method,
        status: paymentStatus,
        reference: input.reference ?? null,
        screenshotUrl: input.screenshotUrl ?? null,
        verifiedBy: input.verifiedBy ?? null,
        paidAt:
          paidAt !== undefined
            ? paidAt
            : paymentStatus === PaymentStatus.SUBMITTED ||
                paymentStatus === PaymentStatus.VERIFIED
              ? new Date()
              : null,
      },
    });

    const order = await syncOrderPaymentStateTx(tx, input.orderId);

    if (
      payment.status === PaymentStatus.SUBMITTED ||
      payment.status === PaymentStatus.VERIFIED
    ) {
      await tx.analyticsEvent.create({
        data: {
          customerId: order.customerId,
          conversationId: order.conversationId,
          leadId: order.leadId,
          orderId: order.id,
          eventType: 'outcome_payment_submitted',
          payloadJson: {
            paymentId: payment.id,
            paymentStatus: payment.status,
            amount: Number(payment.amount.toString()),
          } satisfies Prisma.InputJsonObject,
        },
      });
    }

    if (order.paymentStatus === PaymentStatus.VERIFIED || order.status === OrderStatus.CONFIRMED) {
      await tx.analyticsEvent.create({
        data: {
          customerId: order.customerId,
          conversationId: order.conversationId,
          leadId: order.leadId,
          orderId: order.id,
          eventType: 'outcome_order_confirmed',
          payloadJson: {
            paymentId: payment.id,
            paymentStatus: order.paymentStatus,
            orderStatus: order.status,
          } satisfies Prisma.InputJsonObject,
        },
      });
    }

    return {
      payment,
      order,
    };
  });
}

export async function updatePayment(paymentId: string, input: UpdatePaymentInput) {
  const prisma = getPrismaClient();
  const existingPayment = await getPaymentById(paymentId);

  return prisma.$transaction(async (tx) => {
    const data: Prisma.PaymentUpdateInput = {};

    if (input.status !== undefined) {
      data.status = input.status;
    }

    if (hasOwnProperty(input, 'reference')) {
      data.reference = input.reference ?? null;
    }

    if (hasOwnProperty(input, 'screenshotUrl')) {
      data.screenshotUrl = input.screenshotUrl ?? null;
    }

    if (hasOwnProperty(input, 'verifiedBy')) {
      data.verifiedBy = input.verifiedBy ?? null;
    }

    if (hasOwnProperty(input, 'paidAt')) {
      data.paidAt = normalizeOptionalDate(input.paidAt, 'paidAt') ?? null;
    } else if (
      input.status === PaymentStatus.VERIFIED &&
      existingPayment.paidAt === null
    ) {
      data.paidAt = new Date();
    }

    const payment = await tx.payment.update({
      where: {
        id: paymentId,
      },
      data,
    });

    const order = await syncOrderPaymentStateTx(tx, existingPayment.orderId);

    if (
      existingPayment.status !== PaymentStatus.SUBMITTED &&
      payment.status === PaymentStatus.SUBMITTED
    ) {
      await tx.analyticsEvent.create({
        data: {
          customerId: order.customerId,
          conversationId: order.conversationId,
          leadId: order.leadId,
          orderId: order.id,
          eventType: 'outcome_payment_submitted',
          payloadJson: {
            paymentId: payment.id,
            paymentStatus: payment.status,
            amount: Number(payment.amount.toString()),
          } satisfies Prisma.InputJsonObject,
        },
      });
    }

    if (
      existingPayment.status !== PaymentStatus.VERIFIED &&
      order.paymentStatus === PaymentStatus.VERIFIED
    ) {
      await tx.analyticsEvent.create({
        data: {
          customerId: order.customerId,
          conversationId: order.conversationId,
          leadId: order.leadId,
          orderId: order.id,
          eventType: 'outcome_order_confirmed',
          payloadJson: {
            paymentId: payment.id,
            paymentStatus: order.paymentStatus,
            orderStatus: order.status,
          } satisfies Prisma.InputJsonObject,
        },
      });
    }

    return {
      payment,
      order,
    };
  });
}
