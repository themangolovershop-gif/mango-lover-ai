import {
  ConversationChannel,
  ExperimentStatus,
  ExperimentType,
  Prisma,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  buildExperimentResults,
  buildFollowUpPerformance,
  buildOptimizationInsights,
  buildRecommendationPerformance,
  buildStrategyPerformanceRows,
} from '@/backend/modules/optimization/optimization.service';

function createEvent(args: {
  conversationId: string;
  eventType: string;
  createdAt: string;
  payloadJson?: Record<string, unknown>;
}) {
  return {
    conversationId: args.conversationId,
    eventType: args.eventType,
    createdAt: new Date(args.createdAt),
    payloadJson: (args.payloadJson ?? null) as Prisma.JsonValue | null,
  };
}

describe('optimization service', () => {
  it('aggregates reply strategy performance from analytics events', () => {
    const events = [
      createEvent({
        conversationId: 'conversation-1',
        eventType: 'reply_strategy_used',
        createdAt: '2026-04-17T10:00:00.000Z',
        payloadJson: {
          strategyName: 'consultative_recommend',
          intentType: 'recommendation_request',
          buyerSegment: 'new_buyer',
          channel: ConversationChannel.WHATSAPP,
          recommendedSize: 'large',
        },
      }),
      createEvent({
        conversationId: 'conversation-1',
        eventType: 'outcome_engaged',
        createdAt: '2026-04-17T10:05:00.000Z',
      }),
      createEvent({
        conversationId: 'conversation-1',
        eventType: 'outcome_order_started',
        createdAt: '2026-04-17T10:06:00.000Z',
      }),
      createEvent({
        conversationId: 'conversation-1',
        eventType: 'outcome_order_confirmed',
        createdAt: '2026-04-17T10:20:00.000Z',
      }),
    ];

    const rows = buildStrategyPerformanceRows(events, new Date('2026-04-18T10:00:00.000Z'));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      strategyName: 'consultative_recommend',
      usesCount: 1,
      responseCount: 1,
      orderStartCount: 1,
      confirmedOrderCount: 1,
      dropOffCount: 0,
    });
  });

  it('builds recommendation and follow-up scorecards from event data', () => {
    const events = [
      createEvent({
        conversationId: 'conversation-2',
        eventType: 'reply_strategy_used',
        createdAt: '2026-04-17T08:00:00.000Z',
        payloadJson: {
          strategyName: 'consultative_recommend',
          intentType: 'recommendation_request',
          buyerSegment: 'repeat_buyer',
          channel: ConversationChannel.WHATSAPP,
          recommendedSize: 'jumbo',
        },
      }),
      createEvent({
        conversationId: 'conversation-2',
        eventType: 'outcome_order_confirmed',
        createdAt: '2026-04-17T09:00:00.000Z',
      }),
      createEvent({
        conversationId: 'conversation-2',
        eventType: 'follow_up_scheduled',
        createdAt: '2026-04-17T11:00:00.000Z',
        payloadJson: {
          delayHours: 2,
        },
      }),
      createEvent({
        conversationId: 'conversation-2',
        eventType: 'follow_up_sent',
        createdAt: '2026-04-17T13:00:00.000Z',
      }),
      createEvent({
        conversationId: 'conversation-2',
        eventType: 'outcome_follow_up_replied',
        createdAt: '2026-04-17T13:15:00.000Z',
      }),
    ];

    const recommendationRows = buildRecommendationPerformance(events);
    const followUpRows = buildFollowUpPerformance(events);

    expect(recommendationRows[0]).toMatchObject({
      recommendedSize: 'jumbo',
      buyerSegment: 'repeat_buyer',
      confirmedOrderCount: 1,
    });
    expect(followUpRows[0]).toMatchObject({
      delayBucket: '0-2h',
      scheduledCount: 1,
      sentCount: 1,
      replyCount: 1,
    });
  });

  it('identifies winning experiments and creates optimization insights', () => {
    const experimentResults = buildExperimentResults([
      {
        id: 'experiment-1',
        name: 'Recommendation wording',
        type: ExperimentType.RECOMMENDATION_COPY,
        status: ExperimentStatus.ACTIVE,
        assignments: [
          { variant: 'A', outcomeLabel: 'engaged' },
          { variant: 'A', outcomeLabel: 'order_confirmed' },
          { variant: 'A', outcomeLabel: 'order_started' },
          { variant: 'B', outcomeLabel: null },
          { variant: 'B', outcomeLabel: null },
          { variant: 'B', outcomeLabel: 'engaged' },
        ],
      },
    ]);

    const insights = buildOptimizationInsights({
      strategyRows: [
        {
          strategyName: 'consultative_recommend',
          intentType: 'recommendation_request',
          buyerSegment: 'new_buyer',
          channel: ConversationChannel.WHATSAPP,
          usesCount: 10,
          responseCount: 8,
          orderStartCount: 6,
          paymentSubmitCount: 4,
          confirmedOrderCount: 5,
          dropOffCount: 1,
          followUpSentCount: 2,
          followUpReplyCount: 1,
          reorderCount: 0,
          humanOverrideCount: 0,
        },
        {
          strategyName: 'premium_soft',
          intentType: 'recommendation_request',
          buyerSegment: 'new_buyer',
          channel: ConversationChannel.WHATSAPP,
          usesCount: 10,
          responseCount: 5,
          orderStartCount: 3,
          paymentSubmitCount: 2,
          confirmedOrderCount: 2,
          dropOffCount: 3,
          followUpSentCount: 3,
          followUpReplyCount: 1,
          reorderCount: 0,
          humanOverrideCount: 1,
        },
      ],
      recommendationRows: [
        {
          recommendedSize: 'large',
          buyerSegment: 'new_buyer',
          usesCount: 12,
          orderStartCount: 7,
          confirmedOrderCount: 6,
        },
        {
          recommendedSize: 'medium',
          buyerSegment: 'new_buyer',
          usesCount: 10,
          orderStartCount: 3,
          confirmedOrderCount: 2,
        },
      ],
      followUpRows: [
        {
          delayBucket: '0-2h',
          scheduledCount: 12,
          sentCount: 10,
          replyCount: 6,
          conversionCount: 5,
        },
        {
          delayBucket: '13-24h',
          scheduledCount: 12,
          sentCount: 10,
          replyCount: 2,
          conversionCount: 1,
        },
      ],
      experimentResults,
      humanOverrideStats: [
        {
          correctionType: 'HUMAN_TAKEOVER',
          count: 6,
        },
      ],
    });

    expect(experimentResults[0]?.winningVariant).toBe('A');
    expect(
      insights.some((insight) => insight.title.includes('consultative_recommend'))
    ).toBe(true);
    expect(
      insights.some((insight) => insight.title.includes('follow-ups recover best'))
    ).toBe(true);
    expect(
      insights.some((insight) => insight.title.includes('Recommendation wording'))
    ).toBe(true);
  });
});
