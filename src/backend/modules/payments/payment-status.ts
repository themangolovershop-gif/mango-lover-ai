import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';

import { toDecimal, type DecimalInput } from '@/backend/modules/orders/order-calculations';

export type PaymentAmountSnapshot = {
  status: PaymentStatus;
  amount: DecimalInput;
};

function sumPayments(
  payments: PaymentAmountSnapshot[],
  statuses: PaymentStatus[]
) {
  return payments.reduce((total, payment) => {
    if (!statuses.includes(payment.status)) {
      return total;
    }

    return total.plus(toDecimal(payment.amount, 'payment.amount'));
  }, new Prisma.Decimal(0));
}

export function deriveAggregatePaymentStatus(
  orderTotal: DecimalInput,
  payments: PaymentAmountSnapshot[]
) {
  if (payments.length === 0) {
    return PaymentStatus.UNPAID;
  }

  const orderTotalDecimal = toDecimal(orderTotal, 'order.totalAmount');
  const verifiedTotal = sumPayments(payments, [PaymentStatus.VERIFIED]);
  const refundedTotal = sumPayments(payments, [PaymentStatus.REFUNDED]);
  const netVerified = Prisma.Decimal.max(verifiedTotal.minus(refundedTotal), 0);
  const hasSubmitted = payments.some((payment) => payment.status === PaymentStatus.SUBMITTED);
  const hasFailed = payments.some((payment) => payment.status === PaymentStatus.FAILED);

  if (netVerified.greaterThanOrEqualTo(orderTotalDecimal) && orderTotalDecimal.greaterThan(0)) {
    return PaymentStatus.VERIFIED;
  }

  if (netVerified.greaterThan(0)) {
    return PaymentStatus.PARTIAL;
  }

  if (refundedTotal.greaterThan(0) && !hasSubmitted) {
    return PaymentStatus.REFUNDED;
  }

  if (hasSubmitted) {
    return PaymentStatus.SUBMITTED;
  }

  if (hasFailed) {
    return PaymentStatus.FAILED;
  }

  return PaymentStatus.UNPAID;
}

export function deriveOrderStatusFromPaymentStatus(
  currentOrderStatus: OrderStatus,
  paymentStatus: PaymentStatus
) {
  const verifiedPreservedStatuses: OrderStatus[] = [
    OrderStatus.PACKED,
    OrderStatus.DISPATCHED,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
    OrderStatus.REFUND_REQUESTED,
    OrderStatus.REFUNDED,
  ];
  const reviewableStatuses: OrderStatus[] = [
    OrderStatus.DRAFT,
    OrderStatus.PENDING_DETAILS,
    OrderStatus.PENDING_PAYMENT,
    OrderStatus.ON_HOLD,
  ];
  const partialStatuses: OrderStatus[] = [
    OrderStatus.DRAFT,
    OrderStatus.PENDING_DETAILS,
    OrderStatus.PAYMENT_UNDER_REVIEW,
    OrderStatus.ON_HOLD,
  ];

  switch (paymentStatus) {
    case PaymentStatus.VERIFIED:
      if (verifiedPreservedStatuses.includes(currentOrderStatus)) {
        return currentOrderStatus;
      }

      return OrderStatus.CONFIRMED;

    case PaymentStatus.SUBMITTED:
      if (reviewableStatuses.includes(currentOrderStatus)) {
        return OrderStatus.PAYMENT_UNDER_REVIEW;
      }

      return currentOrderStatus;

    case PaymentStatus.PARTIAL:
      if (partialStatuses.includes(currentOrderStatus)) {
        return OrderStatus.PENDING_PAYMENT;
      }

      return currentOrderStatus;

    case PaymentStatus.FAILED:
      if (currentOrderStatus === OrderStatus.PAYMENT_UNDER_REVIEW) {
        return OrderStatus.PENDING_PAYMENT;
      }

      return currentOrderStatus;

    case PaymentStatus.REFUNDED:
      return currentOrderStatus === OrderStatus.CANCELLED
        ? OrderStatus.CANCELLED
        : OrderStatus.REFUNDED;

    case PaymentStatus.UNPAID:
    default:
      if (currentOrderStatus === OrderStatus.PAYMENT_UNDER_REVIEW) {
        return OrderStatus.PENDING_PAYMENT;
      }

      return currentOrderStatus;
  }
}
