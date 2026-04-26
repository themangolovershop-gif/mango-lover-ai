import { describe, expect, it, vi } from 'vitest';

const { deepResetMock } = vi.hoisted(() => ({
  deepResetMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/backend/modules/session/reset.service', () => ({
  SessionResetService: class SessionResetService {
    deepReset = deepResetMock;
  },
}));

import { ResponseComposer } from '@/backend/modules/agents/composer.service';
import { masterAgent } from '@/backend/modules/agents/master-agent.service';
import type { AgentContext, AgentResult } from '@/backend/modules/agents/types';
import type { ResponseGroundingContext } from '@/backend/modules/ai/response-grounding.service';
import type { MemoryContextSnapshot } from '@/backend/modules/memory/types';

function buildMemorySnapshot(overrides: Partial<MemoryContextSnapshot> = {}): MemoryContextSnapshot {
  return {
    profile: {
      customerId: 'customer-1',
      phone: '+919999999999',
      repeatCustomer: false,
      updatedAt: '2026-04-18T00:00:00.000Z',
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
      isRepeat: false,
      isVip: false,
      vipScore: 0,
      shouldUseShortReplies: true,
      likelyNeedsRecommendation: true,
      usuallyPaysFast: false,
    },
    conversationSummary: 'Customer asked about mangoes.',
    ...overrides,
  };
}

function buildGroundingSnapshot(
  toolResults: ResponseGroundingContext['toolResults'],
  groundedReplyHint?: string
): ResponseGroundingContext {
  return {
    toolPlanSummary: toolResults.map((result) => `${result.name}: ${result.summary}`),
    toolResults,
    groundedReplyHint,
    groundingRules: [
      'Do not guess live order or payment data when tool results are available.',
    ],
  };
}

function buildContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    customerId: 'customer-1',
    conversationId: 'conversation-1',
    leadId: 'lead-1',
    customerName: 'Vinod',
    phone: '+919999999999',
    latestMessage: 'price?',
    recentHistory: 'Customer: price?',
    recentAssistantReplies: [],
    intents: ['pricing'],
    primaryIntent: 'pricing',
    entities: {},
    leadStage: 'ENGAGED',
    buyerType: 'PERSONAL',
    nextAction: 'EDUCATE',
    latestOrder: null,
    memorySnapshot: buildMemorySnapshot(),
    groundingSnapshot: buildGroundingSnapshot([]),
    ...overrides,
  };
}

describe('master-agent.service', () => {
  it('routes restart requests through recovery and uses the reset reply', async () => {
    const result = await masterAgent.process(
      buildContext({
        latestMessage: 'start again',
        intents: ['restart_order_request'],
        primaryIntent: 'restart_order_request',
        nextAction: 'COLLECT_QUANTITY_AND_CITY',
        groundingSnapshot: buildGroundingSnapshot([
          {
            name: 'restart_order_session',
            ok: true,
            summary: 'Cancelled draft order for restart.',
            replyHint:
              'Understood. I have cleared the current draft. Tell me the size and quantity you want, and I will guide you.',
          },
        ]),
      })
    );

    expect(result.decision.primaryAgent).toBe('recovery');
    expect(result.responseText).toContain('cleared the current draft');
  });

  it('routes order summary requests to order operations', async () => {
    const result = await masterAgent.process(
      buildContext({
        latestMessage: 'what did i order?',
        intents: ['order_summary_request'],
        primaryIntent: 'order_summary_request',
        groundingSnapshot: buildGroundingSnapshot([
          {
            name: 'get_current_order_summary',
            ok: true,
            summary: 'Current order MLS-1: 2 large boxes. Status PENDING_PAYMENT.',
            replyHint:
              'You currently have 2 dozen Large Devgad Alphonso in draft for Mumbai delivery. If you want, I can help you confirm it or make changes.',
          },
        ]),
      })
    );

    expect(result.decision.primaryAgent).toBe('order_ops');
    expect(result.responseText).toContain('2 dozen Large Devgad Alphonso');
  });

  it('routes mango knowledge questions to the mango expert agent', async () => {
    const result = await masterAgent.process(
      buildContext({
        latestMessage: 'natural hai?',
        intents: ['quality_check'],
        primaryIntent: 'quality_check',
        groundingSnapshot: buildGroundingSnapshot([
          {
            name: 'search_mango_knowledge',
            ok: true,
            summary: 'Natural ripening article.',
            replyHint:
              'Yes. Our fruit is naturally ripened, which helps preserve the aroma, texture, and overall eating experience.',
          },
        ]),
      })
    );

    expect(result.decision.primaryAgent).toBe('mango_expert');
    expect(result.responseText).toContain('naturally ripened');
  });

  it('uses a grounded catalog overview for generic pricing questions', async () => {
    const result = await masterAgent.process(
      buildContext({
        latestMessage: 'price?',
        intents: ['pricing'],
        primaryIntent: 'pricing',
        groundingSnapshot: buildGroundingSnapshot([
          {
            name: 'get_catalog_overview' as any,
            ok: true,
            summary: 'Active catalog overview.',
            replyHint:
              'Current premium mango availability is Medium INR 1199, Large INR 1499, and Jumbo INR 1999. Tell me the size and quantity you want, and I will guide you from there.',
          },
        ]),
      })
    );

    expect(result.responseText).toContain('Medium INR 1199');
    expect(result.responseText).toContain('Large INR 1499');
    expect(result.responseText).toContain('Jumbo INR 1999');
  });
});

describe('response-composer', () => {
  it('avoids reusing a reply that matches the last three assistant replies', () => {
    const composer = new ResponseComposer();
    const context = buildContext({
      recentAssistantReplies: [
        'Tell me the size, quantity, and city you want, and I will prepare the current quote for you.',
      ],
    });
    const results: AgentResult[] = [
      {
        agent: 'sales',
        summary: 'Asked for missing quote inputs.',
        replyHint: 'Tell me the size, quantity, and city you want, and I will prepare the current quote for you.',
        confidence: 0.9,
      },
      {
        agent: 'recovery',
        summary: 'Breaking a stuck conversational loop.',
        replyHint: 'I may have misunderstood slightly. Would you like pricing, a recommendation, or to start an order?',
        confidence: 0.95,
      },
    ];

    const response = composer.compose(context, results);

    expect(response).toContain('misunderstood slightly');
    expect(response).not.toContain('prepare the current quote');
  });

  it('adds a warmer advisory lead-in to pricing replies without losing the quote request', () => {
    const composer = new ResponseComposer();
    const context = buildContext({
      intents: ['pricing'],
      primaryIntent: 'pricing',
      recentAssistantReplies: [],
    });
    const results: AgentResult[] = [
      {
        agent: 'sales',
        summary: 'Asked for missing quote inputs.',
        replyHint: 'Tell me the size, quantity, and city you want, and I will prepare the current quote for you.',
        confidence: 0.9,
      },
    ];

    const response = composer.compose(context, results);

    expect(response).toContain('That is a great question');
    expect(response).toContain('prepare the current quote');
  });

  it('blends mango expertise with a soft next step when advisory and sales replies are both available', () => {
    const composer = new ResponseComposer();
    const context = buildContext({
      intents: ['quality_check', 'pricing'],
      primaryIntent: 'quality_check',
      recentAssistantReplies: [],
    });
    const results: AgentResult[] = [
      {
        agent: 'mango_expert',
        summary: 'Answered from mango knowledge.',
        replyHint: 'Yes. Our fruit is naturally ripened, which helps preserve the aroma, texture, and eating experience.',
        confidence: 0.98,
      },
      {
        agent: 'sales',
        summary: 'Asked for quote inputs.',
        replyHint: 'Tell me the size, quantity, and city you want, and I will prepare the current quote for you.',
        confidence: 0.9,
      },
    ];

    const response = composer.compose(context, results);

    expect(response).toContain('naturally ripened');
    expect(response).toContain('prepare the current quote');
  });
});
