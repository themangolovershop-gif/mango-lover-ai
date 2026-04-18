import {
  BuyerType,
  EscalationSeverity,
  EscalationType,
  FulfillmentStatus,
  OrderStatus,
  PaymentStatus,
  ProductSize,
  Prisma,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  buildOrderSummary,
  determineEscalationPlan,
  determineFollowUpPlan,
  mapBuyerTypeToPrisma,
  mapLeadStageToPrisma,
  mapLeadTemperatureToPrisma,
} from '@/backend/modules/whatsapp/message-orchestrator.helpers';

describe('message-orchestrator.helpers', () => {
  it('maps derived lead metadata back to Prisma enums', () => {
    expect(mapBuyerTypeToPrisma('BULK')).toBe(BuyerType.BULK);
    expect(mapLeadStageToPrisma('AWAITING_PAYMENT')).toBe('AWAITING_PAYMENT');
    expect(mapLeadTemperatureToPrisma('HOT')).toBe('HOT');
  });

  it('builds a deterministic order summary for reply prompts', () => {
    const order = {
      id: 'order-1',
      customerId: 'customer-1',
      conversationId: 'conversation-1',
      leadId: 'lead-1',
      orderNumber: 'MLS-123456',
      status: OrderStatus.PENDING_PAYMENT,
      paymentStatus: PaymentStatus.UNPAID,
      fulfillmentStatus: FulfillmentStatus.NOT_STARTED,
      subtotal: new Prisma.Decimal(3798),
      deliveryCharge: new Prisma.Decimal(0),
      discountAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(3798),
      currency: 'INR',
      notes: null,
      paymentReference: null,
      createdAt: new Date('2026-04-18T00:00:00.000Z'),
      updatedAt: new Date('2026-04-18T00:00:00.000Z'),
      items: [
        {
          quantity: 2,
          product: {
            size: ProductSize.LARGE,
          },
        },
      ],
    };

    expect(buildOrderSummary(order)).toBe(
      'Current order MLS-123456: 2 large boxes. Status PENDING_PAYMENT. Payment UNPAID. Total INR 3798.00.'
    );
    expect(buildOrderSummary(null)).toBeUndefined();
  });

  it('prioritizes complaint and refund escalations over generic fallback rules', () => {
    expect(
      determineEscalationPlan({
        intents: ['complaint', 'bulk_order'],
        buyerType: 'BULK',
        nextAction: 'REQUEST_PAYMENT',
      })
    ).toEqual({
      type: EscalationType.COMPLAINT,
      severity: EscalationSeverity.HIGH,
      reason: 'Customer reported a complaint in WhatsApp conversation.',
    });

    expect(
      determineEscalationPlan({
        intents: ['refund'],
        buyerType: 'PERSONAL',
        nextAction: 'ESCALATE_HUMAN',
      })
    ).toEqual({
      type: EscalationType.REFUND_REQUEST,
      severity: EscalationSeverity.HIGH,
      reason: 'Customer requested a refund in WhatsApp conversation.',
    });
  });

  it('falls back to low-confidence or bulk-order escalation when applicable', () => {
    expect(
      determineEscalationPlan({
        intents: ['pricing'],
        buyerType: 'PERSONAL',
        nextAction: 'ESCALATE_HUMAN',
      })
    ).toEqual({
      type: EscalationType.LOW_CONFIDENCE,
      severity: EscalationSeverity.MEDIUM,
      reason: 'Conversation requires human assistance.',
    });

    expect(
      determineEscalationPlan({
        intents: ['bulk_order'],
        buyerType: 'BULK',
        nextAction: 'COLLECT_QUANTITY_AND_CITY',
      })
    ).toEqual({
      type: EscalationType.BULK_ORDER,
      severity: EscalationSeverity.MEDIUM,
      reason: 'Potential bulk order detected.',
    });

    expect(
      determineEscalationPlan({
        intents: ['pricing'],
        buyerType: 'PERSONAL',
        nextAction: 'EDUCATE',
      })
    ).toBeNull();
  });

  it('schedules deterministic follow-ups and suppresses them during human escalation', () => {
    expect(
      determineFollowUpPlan({
        leadStage: 'AWAITING_PAYMENT',
        nextAction: 'REQUEST_PAYMENT',
        needsHuman: false,
      })
    ).toEqual({
      type: 'PAYMENT_PENDING',
      reason: 'Awaiting payment confirmation from customer.',
      delayHours: 6,
    });

    expect(
      determineFollowUpPlan({
        leadStage: 'ENGAGED',
        nextAction: 'COLLECT_QUANTITY_AND_CITY',
        needsHuman: false,
      })
    ).toEqual({
      type: 'DETAILS_PENDING',
      reason: 'Awaiting additional order details from customer.',
      delayHours: 6,
    });

    expect(
      determineFollowUpPlan({
        leadStage: 'CONFIRMED',
        nextAction: 'CONFIRM_ORDER',
        needsHuman: false,
      })
    ).toEqual({
      type: 'REPEAT_REACTIVATION',
      reason: 'Confirmed order completed; schedule reactivation follow-up.',
      delayHours: 120,
    });

    expect(
      determineFollowUpPlan({
        leadStage: 'ESCALATED',
        nextAction: 'ESCALATE_HUMAN',
        needsHuman: true,
      })
    ).toBeNull();
  });
});
