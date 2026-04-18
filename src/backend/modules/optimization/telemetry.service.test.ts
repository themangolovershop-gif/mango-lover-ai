import { describe, expect, it } from 'vitest';

import { deriveBuyerSegment, deriveReplyStrategy, isPriceObjectionMessage } from '@/backend/modules/optimization/telemetry.service';
import type { ReplyStrategySelectionInput } from '@/backend/modules/optimization/types';

function buildSelectionInput(
  overrides: Partial<ReplyStrategySelectionInput> = {}
): ReplyStrategySelectionInput {
  return {
    customerId: 'customer-1',
    conversationId: 'conversation-1',
    leadId: 'lead-1',
    latestMessage: 'which is best?',
    leadStage: 'ENGAGED',
    buyerType: 'personal',
    intents: ['recommendation_request'],
    primaryIntent: 'recommendation_request',
    nextAction: 'RECOMMEND_PRODUCT',
    entities: {},
    memorySnapshot: null,
    groundingSnapshot: null,
    agentSnapshot: null,
    ...overrides,
  };
}

describe('optimization telemetry', () => {
  it('detects price objection wording reliably', () => {
    expect(isPriceObjectionMessage('This is expensive.')).toBe(true);
    expect(isPriceObjectionMessage('Which size is best?')).toBe(false);
  });

  it('prioritizes VIP and repeat segments from memory', () => {
    expect(
      deriveBuyerSegment({
        buyerType: 'personal',
        memorySnapshot: {
          profile: {
            customerId: 'customer-1',
            phone: '+919999999999',
            repeatCustomer: true,
            updatedAt: new Date().toISOString(),
          },
          sales: {
            currentLeadStage: 'ENGAGED',
            leadScoreTrend: 'stable',
            followUpSuccess: 'unknown',
            objectionHistory: [],
            commonQuestions: [],
            paymentBehavior: 'unknown',
          },
          session: {
            repeatGuardState: 'clear',
            restartRequested: false,
          },
          personalization: {
            isRepeat: true,
            isVip: true,
            vipScore: 80,
            shouldUseShortReplies: true,
            likelyNeedsRecommendation: true,
            usuallyPaysFast: true,
          },
          conversationSummary: 'VIP repeat buyer.',
        },
      })
    ).toBe('vip_buyer');
  });

  it('uses recovery strategy for interrupt-driven agent decisions', () => {
    expect(
      deriveReplyStrategy(
        buildSelectionInput({
          latestMessage: 'start again',
          intents: ['restart_order_request'],
          primaryIntent: 'restart_order_request',
          agentSnapshot: {
            responseText: 'Understood. We can start fresh.',
            decision: {
              primaryAgent: 'recovery',
              secondaryAgents: [],
              reason: 'Interrupt detected',
              interruptDetected: true,
            },
            results: [],
          },
        })
      )
    ).toBe('recovery_guard');
  });

  it('uses payment closer strategy for payment request actions', () => {
    expect(
      deriveReplyStrategy(
        buildSelectionInput({
          latestMessage: 'ok send payment details',
          intents: ['payment_update'],
          primaryIntent: 'payment_update',
          nextAction: 'REQUEST_PAYMENT',
        })
      )
    ).toBe('payment_closer');
  });
});
