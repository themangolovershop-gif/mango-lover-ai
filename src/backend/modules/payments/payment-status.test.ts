import { OrderStatus, PaymentStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  deriveAggregatePaymentStatus,
  deriveOrderStatusFromPaymentStatus,
} from '@/backend/modules/payments/payment-status';

describe('payment-status', () => {
  it('marks an order as verified only when verified payments cover the total', () => {
    expect(
      deriveAggregatePaymentStatus(3798, [
        { status: PaymentStatus.VERIFIED, amount: 2000 },
        { status: PaymentStatus.VERIFIED, amount: 1798 },
      ])
    ).toBe(PaymentStatus.VERIFIED);
  });

  it('keeps partial payments below the order total in PARTIAL state', () => {
    expect(
      deriveAggregatePaymentStatus(3798, [
        { status: PaymentStatus.VERIFIED, amount: 2000 },
      ])
    ).toBe(PaymentStatus.PARTIAL);
  });

  it('moves draft orders into payment review when payment is submitted', () => {
    expect(
      deriveOrderStatusFromPaymentStatus(
        OrderStatus.DRAFT,
        PaymentStatus.SUBMITTED
      )
    ).toBe(OrderStatus.PAYMENT_UNDER_REVIEW);
  });

  it('confirms unpaid workflow orders after verified payment without overwriting shipped states', () => {
    expect(
      deriveOrderStatusFromPaymentStatus(
        OrderStatus.PENDING_PAYMENT,
        PaymentStatus.VERIFIED
      )
    ).toBe(OrderStatus.CONFIRMED);

    expect(
      deriveOrderStatusFromPaymentStatus(
        OrderStatus.DISPATCHED,
        PaymentStatus.VERIFIED
      )
    ).toBe(OrderStatus.DISPATCHED);
  });
});
