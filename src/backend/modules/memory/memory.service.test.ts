import { describe, expect, it } from 'vitest';

import {
  buildConversationSummary,
  buildPersonalizationContext,
  buildPersonalizedFollowUpMessage,
  getVipScore,
} from '@/backend/modules/memory/memory.service';
import type {
  CustomerMemoryProfile,
  SalesMemoryState,
  SessionMemoryState,
} from '@/backend/modules/memory/types';

function buildProfile(overrides: Partial<CustomerMemoryProfile> = {}): CustomerMemoryProfile {
  return {
    customerId: 'customer-1',
    name: 'Vinod Gupta',
    phone: '+919999999999',
    city: 'mumbai',
    repeatCustomer: true,
    buyerType: 'repeat',
    preferredSize: 'large',
    averageQuantityDozen: 3,
    usuallyPaysFast: true,
    lastOrderDate: '2026-04-15T00:00:00.000Z',
    lastOrderSize: 'large',
    lastOrderQuantityDozen: 2,
    lastOrderValue: 5400,
    notes: ['Repeat buyer'],
    updatedAt: '2026-04-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('memory.service', () => {
  it('scores repeat fast-paying higher-value buyers as VIPs', () => {
    expect(getVipScore(buildProfile())).toBe(80);
  });

  it('builds personalization context with a reorder hint for repeat buyers', () => {
    const personalization = buildPersonalizationContext(buildProfile());

    expect(personalization.isRepeat).toBe(true);
    expect(personalization.isVip).toBe(true);
    expect(personalization.reorderHint).toContain('Welcome back.');
    expect(personalization.reorderHint).toContain('Large');
    expect(personalization.reorderHint).toContain('Mumbai');
  });

  it('builds a compact conversation summary for prompt context', () => {
    const profile = buildProfile({
      priceSensitive: true,
      prefersRecommendations: true,
    });
    const personalization = buildPersonalizationContext(profile);
    const sales: SalesMemoryState = {
      currentLeadStage: 'AWAITING_PAYMENT',
      buyerType: 'repeat',
      leadScoreTrend: 'rising',
      followUpSuccess: 'strong',
      objectionHistory: ['price'],
      commonQuestions: ['pricing', 'delivery'],
      paymentBehavior: 'fast',
      currentLeadScore: 85,
    };
    const session: SessionMemoryState = {
      latestUserIntent: 'payment_update',
      pendingClarification: 'Awaiting payment confirmation.',
      repeatGuardState: 'watch',
      currentDraftSummary:
        'Current order MLS-123456: 2 large boxes. Status PENDING_PAYMENT. Payment UNPAID. Total INR 3798.00.',
      restartRequested: false,
      lastBotAction: 'REQUEST_PAYMENT',
    };

    const summary = buildConversationSummary({
      profile,
      personalization,
      sales,
      session,
    });

    expect(summary).toContain('VIP repeat buyer');
    expect(summary).toContain('Current draft');
    expect(summary).toContain('Avoid repeating the same action verbatim');
  });

  it('personalizes repeat reactivation follow-ups for reorder-friendly buyers', () => {
    const profile = buildProfile();
    const personalization = buildPersonalizationContext(profile);
    const session: SessionMemoryState = {
      repeatGuardState: 'clear',
      restartRequested: false,
    };

    const message = buildPersonalizedFollowUpMessage({
      followUpType: 'REPEAT_REACTIVATION',
      profile,
      personalization,
      session,
    });

    expect(message).toContain('Welcome back.');
    expect(message).toContain('same quantity');
  });

  it('switches to value-focused follow-ups for price-sensitive buyers', () => {
    const profile = buildProfile({
      repeatCustomer: false,
      buyerType: 'personal',
      priceSensitive: true,
      lastOrderSize: undefined,
      preferredSize: undefined,
      lastOrderQuantityDozen: undefined,
      averageQuantityDozen: undefined,
      lastOrderValue: 2800,
    });
    const personalization = buildPersonalizationContext(profile);
    const session: SessionMemoryState = {
      repeatGuardState: 'clear',
      restartRequested: false,
    };

    const message = buildPersonalizedFollowUpMessage({
      followUpType: 'DETAILS_PENDING',
      profile,
      personalization,
      session,
    });

    expect(message).toContain('budget');
    expect(message).not.toContain('Welcome back');
  });
});
