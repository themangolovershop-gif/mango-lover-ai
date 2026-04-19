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

  it('moves draft orders into awaiting confirmation when payment is submitted', () => {
    expect(
      deriveOrderStatusFromPaymentStatus(
        OrderStatus.DRAFT,
        PaymentStatus.SUBMITTED
      )
    ).toBe(OrderStatus.AWAITING_CONFIRMATION);
  });

  it('confirms reviewable orders after verified payment without overwriting cancelled states', () => {
    expect(
      deriveOrderStatusFromPaymentStatus(
        OrderStatus.AWAITING_CONFIRMATION,
        PaymentStatus.VERIFIED
      )
    ).toBe(OrderStatus.CONFIRMED);

    expect(
      deriveOrderStatusFromPaymentStatus(
        OrderStatus.CANCELLED,
        PaymentStatus.VERIFIED
      )
    ).toBe(OrderStatus.CANCELLED);
  });
});
