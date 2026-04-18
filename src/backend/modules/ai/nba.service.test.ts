import { describe, expect, it } from 'vitest';

import { decideNextAction } from '@/backend/modules/ai/nba.service';

describe('nba.service', () => {
  it('prefers educate for order support requests even during payment stages', () => {
    expect(
      decideNextAction({
        leadStage: 'AWAITING_PAYMENT',
        intents: ['order_summary_request'],
        entities: {},
        hasOrder: true,
        paymentStatus: 'UNPAID',
      })
    ).toBe('EDUCATE');
  });

  it('restarts collection when the customer wants to start again', () => {
    expect(
      decideNextAction({
        leadStage: 'AWAITING_PAYMENT',
        intents: ['restart_order_request'],
        entities: {},
        hasOrder: true,
        paymentStatus: 'UNPAID',
      })
    ).toBe('COLLECT_QUANTITY_AND_CITY');
  });

  it('still prioritizes human escalation and complaints over interrupt flows', () => {
    expect(
      decideNextAction({
        leadStage: 'AWAITING_PAYMENT',
        intents: ['refund', 'restart_order_request'],
        entities: {},
        hasOrder: true,
        paymentStatus: 'UNPAID',
      })
    ).toBe('ESCALATE_HUMAN');

    expect(
      decideNextAction({
        leadStage: 'ENGAGED',
        intents: ['complaint', 'order_summary_request'],
        entities: {},
        hasOrder: true,
        paymentStatus: 'UNPAID',
      })
    ).toBe('HANDLE_COMPLAINT');
  });
});
