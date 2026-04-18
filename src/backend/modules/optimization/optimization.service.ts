import {
  ConversationChannel,
  ExperimentStatus,
  type ExperimentType,
  OptimizationInsightCategory,
  OptimizationInsightStatus,
  Prisma,
} from '@prisma/client';

import { logger } from '@/backend/shared/lib/logger';
import { getPrismaClient } from '@/backend/shared/lib/prisma';

import type {
  FollowUpPerformanceRow,
  HumanOverrideStat,
  OptimizationExperimentResult,
  RecommendationPerformanceRow,
  StrategyPerformanceRowInput,
} from './types';

type AnalyticsEventLike = {
  conversationId?: string | null;
  eventType: string;
  payloadJson: Prisma.JsonValue | null;
  createdAt: Date;
};

type InsightDraft = {
  category: OptimizationInsightCategory;
  title: string;
  description: string;
  confidence: number;
  impactLevel: string;
  supportingDataJson?: Prisma.InputJsonValue;
};

const MIN_SAMPLE_SIZE = 5;
const MIN_RATE_DELTA = 0.08;
const DROP_OFF_WINDOW_HOURS = 24;
const POSITIVE_OUTCOME_TYPES = new Set([
  'outcome_engaged',
  'outcome_follow_up_replied',
  'outcome_order_started',
  'outcome_payment_submitted',
  'outcome_order_confirmed',
  'outcome_reordered',
  'outcome_human_closed_successfully',
  'outcome_human_takeover',
  'human_feedback_recorded',
]);
const CONVERSION_OUTCOME_TYPES = new Set([
  'outcome_order_started',
  'outcome_payment_submitted',
  'outcome_order_confirmed',
  'outcome_reordered',
]);
const WINNING_OUTCOME_LABELS = new Set([
  'engaged',
  'order_started',
  'payment_submitted',
  'order_confirmed',
  'reordered',
  'human_closed_successfully',
]);

function asRecord(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function parseChannel(value?: string) {
  if (value === ConversationChannel.WHATSAPP) {
    return ConversationChannel.WHATSAPP;
  }

  if (value === ConversationChannel.INSTAGRAM) {
    return ConversationChannel.INSTAGRAM;
  }

  if (value === ConversationChannel.FACEBOOK) {
    return ConversationChannel.FACEBOOK;
  }

  if (value === ConversationChannel.WEBCHAT) {
    return ConversationChannel.WEBCHAT;
  }

  if (value === ConversationChannel.MANUAL_CALL) {
    return ConversationChannel.MANUAL_CALL;
  }

  return ConversationChannel.WHATSAPP;
}

function incrementMetric(
  map: Map<string, StrategyPerformanceRowInput>,
  row: StrategyPerformanceRowInput
) {
  const key = `${row.strategyName}|${row.intentType}|${row.buyerSegment}|${row.channel}`;
  const existing = map.get(key);

  if (!existing) {
    map.set(key, row);
    return;
  }

  existing.usesCount += row.usesCount;
  existing.responseCount += row.responseCount;
  existing.orderStartCount += row.orderStartCount;
  existing.paymentSubmitCount += row.paymentSubmitCount;
  existing.confirmedOrderCount += row.confirmedOrderCount;
  existing.dropOffCount += row.dropOffCount;
  existing.followUpSentCount += row.followUpSentCount;
  existing.followUpReplyCount += row.followUpReplyCount;
  existing.reorderCount += row.reorderCount;
  existing.humanOverrideCount += row.humanOverrideCount;
}

function groupEventsByConversation(events: AnalyticsEventLike[]) {
  const grouped = new Map<string, AnalyticsEventLike[]>();

  for (const event of events) {
    const conversationId = event.conversationId;

    if (!conversationId) {
      continue;
    }

    const bucket = grouped.get(conversationId) ?? [];
    bucket.push(event);
    grouped.set(conversationId, bucket);
  }

  for (const bucket of grouped.values()) {
    bucket.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  return grouped;
}

function getWindowEvents(events: AnalyticsEventLike[], startIndex: number, boundaryEventType: string) {
  const current = events[startIndex];
  let endIndex = events.length;

  for (let index = startIndex + 1; index < events.length; index += 1) {
    if (events[index].eventType === boundaryEventType) {
      endIndex = index;
      break;
    }
  }

  return {
    current,
    nextIndex: endIndex,
    window: events.slice(startIndex + 1, endIndex),
  };
}

function toDelayBucket(delayHours?: number) {
  if (delayHours === undefined || Number.isNaN(delayHours)) {
    return 'unknown';
  }

  if (delayHours <= 2) {
    return '0-2h';
  }

  if (delayHours <= 6) {
    return '3-6h';
  }

  if (delayHours <= 12) {
    return '7-12h';
  }

  if (delayHours <= 24) {
    return '13-24h';
  }

  return '24h+';
}

function toRate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function findBestAndRunnerUp<T extends { usesCount: number }>(
  rows: T[],
  getScore: (row: T) => number
) {
  const eligible = rows.filter((row) => row.usesCount >= MIN_SAMPLE_SIZE);
  const sorted = [...eligible].sort((left, right) => getScore(right) - getScore(left));

  return {
    best: sorted[0],
    runnerUp: sorted[1],
  };
}

export function buildStrategyPerformanceRows(
  events: AnalyticsEventLike[],
  asOf = new Date()
) {
  const grouped = groupEventsByConversation(events);
  const aggregate = new Map<string, StrategyPerformanceRowInput>();

  for (const conversationEvents of grouped.values()) {
    for (let index = 0; index < conversationEvents.length; index += 1) {
      const event = conversationEvents[index];

      if (event.eventType !== 'reply_strategy_used') {
        continue;
      }

      const payload = asRecord(event.payloadJson);
      const strategyName = readString(payload, 'strategyName');
      const intentType = readString(payload, 'intentType');
      const buyerSegment = readString(payload, 'buyerSegment');

      if (!strategyName || !intentType || !buyerSegment) {
        continue;
      }

      const channel = parseChannel(readString(payload, 'channel'));
      const { window } = getWindowEvents(conversationEvents, index, 'reply_strategy_used');
      const hasPositiveResponse = window.some((windowEvent) => POSITIVE_OUTCOME_TYPES.has(windowEvent.eventType));
      const orderStarted = window.some((windowEvent) => windowEvent.eventType === 'outcome_order_started');
      const paymentSubmitted = window.some((windowEvent) => windowEvent.eventType === 'outcome_payment_submitted');
      const orderConfirmed = window.some((windowEvent) => windowEvent.eventType === 'outcome_order_confirmed');
      const followUpSent = window.some((windowEvent) => windowEvent.eventType === 'follow_up_sent');
      const followUpReply = window.some((windowEvent) => windowEvent.eventType === 'outcome_follow_up_replied');
      const reordered = window.some((windowEvent) => windowEvent.eventType === 'outcome_reordered');
      const humanOverride = window.some(
        (windowEvent) =>
          windowEvent.eventType === 'human_feedback_recorded' ||
          windowEvent.eventType === 'outcome_human_takeover'
      );
      const eventAgeHours = (asOf.getTime() - event.createdAt.getTime()) / (1000 * 60 * 60);

      incrementMetric(aggregate, {
        strategyName,
        intentType,
        buyerSegment,
        channel,
        usesCount: 1,
        responseCount: hasPositiveResponse ? 1 : 0,
        orderStartCount: orderStarted ? 1 : 0,
        paymentSubmitCount: paymentSubmitted ? 1 : 0,
        confirmedOrderCount: orderConfirmed ? 1 : 0,
        dropOffCount:
          !hasPositiveResponse && eventAgeHours >= DROP_OFF_WINDOW_HOURS ? 1 : 0,
        followUpSentCount: followUpSent ? 1 : 0,
        followUpReplyCount: followUpReply ? 1 : 0,
        reorderCount: reordered ? 1 : 0,
        humanOverrideCount: humanOverride ? 1 : 0,
      });
    }
  }

  return Array.from(aggregate.values());
}

export function buildRecommendationPerformance(events: AnalyticsEventLike[]) {
  const grouped = groupEventsByConversation(events);
  const aggregate = new Map<string, RecommendationPerformanceRow>();

  for (const conversationEvents of grouped.values()) {
    for (let index = 0; index < conversationEvents.length; index += 1) {
      const event = conversationEvents[index];

      if (event.eventType !== 'reply_strategy_used') {
        continue;
      }

      const payload = asRecord(event.payloadJson);
      const recommendedSize = readString(payload, 'recommendedSize');
      const buyerSegment = readString(payload, 'buyerSegment');

      if (!recommendedSize || !buyerSegment) {
        continue;
      }

      const { window } = getWindowEvents(conversationEvents, index, 'reply_strategy_used');
      const key = `${recommendedSize}|${buyerSegment}`;
      const existing =
        aggregate.get(key) ??
        ({
          recommendedSize,
          buyerSegment,
          usesCount: 0,
          orderStartCount: 0,
          confirmedOrderCount: 0,
        } satisfies RecommendationPerformanceRow);

      existing.usesCount += 1;
      existing.orderStartCount += window.some((windowEvent) => windowEvent.eventType === 'outcome_order_started')
        ? 1
        : 0;
      existing.confirmedOrderCount += window.some((windowEvent) => windowEvent.eventType === 'outcome_order_confirmed')
        ? 1
        : 0;
      aggregate.set(key, existing);
    }
  }

  return Array.from(aggregate.values());
}

export function buildFollowUpPerformance(events: AnalyticsEventLike[]) {
  const grouped = groupEventsByConversation(events);
  const aggregate = new Map<string, FollowUpPerformanceRow>();

  for (const conversationEvents of grouped.values()) {
    for (let index = 0; index < conversationEvents.length; index += 1) {
      const event = conversationEvents[index];

      if (event.eventType !== 'follow_up_scheduled') {
        continue;
      }

      const payload = asRecord(event.payloadJson);
      const delayBucket = toDelayBucket(readNumber(payload, 'delayHours'));
      const { window } = getWindowEvents(conversationEvents, index, 'follow_up_scheduled');
      const existing =
        aggregate.get(delayBucket) ??
        ({
          delayBucket,
          scheduledCount: 0,
          sentCount: 0,
          replyCount: 0,
          conversionCount: 0,
        } satisfies FollowUpPerformanceRow);

      existing.scheduledCount += 1;
      existing.sentCount += window.some((windowEvent) => windowEvent.eventType === 'follow_up_sent') ? 1 : 0;
      existing.replyCount += window.some((windowEvent) => windowEvent.eventType === 'outcome_follow_up_replied') ? 1 : 0;
      existing.conversionCount += window.some((windowEvent) => CONVERSION_OUTCOME_TYPES.has(windowEvent.eventType))
        ? 1
        : 0;
      aggregate.set(delayBucket, existing);
    }
  }

  return Array.from(aggregate.values());
}

export function buildExperimentResults(
  experiments: Array<{
    id: string;
    name: string;
    type: ExperimentType;
    status: ExperimentStatus;
    assignments: Array<{
      variant: string;
      outcomeLabel: string | null;
    }>;
  }>
) {
  return experiments.map<OptimizationExperimentResult>((experiment) => {
    const variantAAssignments = experiment.assignments.filter((assignment) => assignment.variant === 'A');
    const variantBAssignments = experiment.assignments.filter((assignment) => assignment.variant === 'B');
    const variantAWins = variantAAssignments.filter((assignment) =>
      assignment.outcomeLabel ? WINNING_OUTCOME_LABELS.has(assignment.outcomeLabel) : false
    ).length;
    const variantBWins = variantBAssignments.filter((assignment) =>
      assignment.outcomeLabel ? WINNING_OUTCOME_LABELS.has(assignment.outcomeLabel) : false
    ).length;
    const sampleSize = experiment.assignments.length;
    const variantARate = toRate(variantAWins, variantAAssignments.length);
    const variantBRate = toRate(variantBWins, variantBAssignments.length);
    const winningVariant =
      sampleSize >= MIN_SAMPLE_SIZE && Math.abs(variantARate - variantBRate) >= MIN_RATE_DELTA
        ? variantARate >= variantBRate
          ? 'A'
          : 'B'
        : undefined;

    return {
      experimentId: experiment.id,
      name: experiment.name,
      type: experiment.type,
      status: experiment.status,
      variantAUsers: variantAAssignments.length,
      variantBUsers: variantBAssignments.length,
      variantAWins,
      variantBWins,
      winningVariant,
      sampleSize,
    };
  });
}

export function buildHumanOverrideStats(
  feedbackEvents: Array<{
    correctionType: string;
  }>
) {
  const aggregate = new Map<string, HumanOverrideStat>();

  for (const feedbackEvent of feedbackEvents) {
    const existing =
      aggregate.get(feedbackEvent.correctionType) ??
      ({
        correctionType: feedbackEvent.correctionType,
        count: 0,
      } satisfies HumanOverrideStat);

    existing.count += 1;
    aggregate.set(feedbackEvent.correctionType, existing);
  }

  return Array.from(aggregate.values()).sort((left, right) => right.count - left.count);
}

export function buildOptimizationInsights(args: {
  strategyRows: StrategyPerformanceRowInput[];
  recommendationRows: RecommendationPerformanceRow[];
  followUpRows: FollowUpPerformanceRow[];
  experimentResults: OptimizationExperimentResult[];
  humanOverrideStats: HumanOverrideStat[];
}) {
  const insights: InsightDraft[] = [];

  const strategyRowsBySegment = new Map<string, StrategyPerformanceRowInput[]>();

  for (const row of args.strategyRows) {
    const bucket = strategyRowsBySegment.get(row.buyerSegment) ?? [];
    bucket.push(row);
    strategyRowsBySegment.set(row.buyerSegment, bucket);
  }

  for (const [buyerSegment, rows] of strategyRowsBySegment.entries()) {
    const { best, runnerUp } = findBestAndRunnerUp(rows, (row) =>
      toRate(row.confirmedOrderCount, row.usesCount)
    );

    if (!best || !runnerUp) {
      continue;
    }

    const bestRate = toRate(best.confirmedOrderCount, best.usesCount);
    const runnerUpRate = toRate(runnerUp.confirmedOrderCount, runnerUp.usesCount);

    if (bestRate - runnerUpRate < MIN_RATE_DELTA) {
      continue;
    }

    insights.push({
      category: OptimizationInsightCategory.REPLY_STRATEGY,
      title: `${best.strategyName} leads ${buyerSegment}`,
      description: `${best.strategyName} is converting ${buyerSegment} better than ${runnerUp.strategyName}, with ${(bestRate * 100).toFixed(1)}% confirmed-order rate versus ${(runnerUpRate * 100).toFixed(1)}%.`,
      confidence: Math.min(0.95, 0.55 + best.usesCount / 100),
      impactLevel: best.confirmedOrderCount >= 5 ? 'high' : 'medium',
      supportingDataJson: {
        buyerSegment,
        winner: best,
        runnerUp,
      } satisfies Prisma.InputJsonObject,
    });
  }

  const recommendationBySegment = new Map<string, RecommendationPerformanceRow[]>();

  for (const row of args.recommendationRows) {
    const bucket = recommendationBySegment.get(row.buyerSegment) ?? [];
    bucket.push(row);
    recommendationBySegment.set(row.buyerSegment, bucket);
  }

  for (const [buyerSegment, rows] of recommendationBySegment.entries()) {
    const { best, runnerUp } = findBestAndRunnerUp(rows, (row) =>
      toRate(row.confirmedOrderCount, row.usesCount)
    );

    if (!best || !runnerUp) {
      continue;
    }

    const bestRate = toRate(best.confirmedOrderCount, best.usesCount);
    const runnerUpRate = toRate(runnerUp.confirmedOrderCount, runnerUp.usesCount);

    if (bestRate - runnerUpRate < MIN_RATE_DELTA) {
      continue;
    }

    insights.push({
      category: OptimizationInsightCategory.RECOMMENDATION,
      title: `${best.recommendedSize} recommendation wins for ${buyerSegment}`,
      description: `${best.recommendedSize} recommendations are outperforming ${runnerUp.recommendedSize} for ${buyerSegment}, with ${(bestRate * 100).toFixed(1)}% confirmed-order rate.`,
      confidence: Math.min(0.93, 0.52 + best.usesCount / 100),
      impactLevel: best.confirmedOrderCount >= 5 ? 'high' : 'medium',
      supportingDataJson: {
        buyerSegment,
        winner: best,
        runnerUp,
      } satisfies Prisma.InputJsonObject,
    });
  }

  const { best: bestFollowUp, runnerUp: runnerUpFollowUp } = findBestAndRunnerUp(
    args.followUpRows.map((row) => ({
      ...row,
      usesCount: row.scheduledCount,
    })),
    (row) => toRate(row.conversionCount, row.scheduledCount)
  );

  if (bestFollowUp && runnerUpFollowUp) {
    const bestRate = toRate(bestFollowUp.conversionCount, bestFollowUp.scheduledCount);
    const runnerUpRate = toRate(runnerUpFollowUp.conversionCount, runnerUpFollowUp.scheduledCount);

    if (bestRate - runnerUpRate >= MIN_RATE_DELTA) {
      insights.push({
        category: OptimizationInsightCategory.FOLLOW_UP_TIMING,
        title: `${bestFollowUp.delayBucket} follow-ups recover best`,
        description: `${bestFollowUp.delayBucket} follow-ups are recovering leads better than ${runnerUpFollowUp.delayBucket}, with ${(bestRate * 100).toFixed(1)}% conversion after scheduling.`,
        confidence: Math.min(0.9, 0.5 + bestFollowUp.scheduledCount / 100),
        impactLevel: bestFollowUp.conversionCount >= 5 ? 'high' : 'medium',
        supportingDataJson: {
          winner: bestFollowUp,
          runnerUp: runnerUpFollowUp,
        } satisfies Prisma.InputJsonObject,
      });
    }
  }

  const trustBuilding = args.strategyRows.find((row) => row.strategyName === 'trust_building' && row.intentType === 'pricing');
  const premiumDirect = args.strategyRows.find((row) => row.strategyName === 'premium_direct' && row.intentType === 'pricing');

  if (trustBuilding && premiumDirect) {
    const trustRate = toRate(trustBuilding.orderStartCount, trustBuilding.usesCount);
    const directRate = toRate(premiumDirect.orderStartCount, premiumDirect.usesCount);

    if (
      trustBuilding.usesCount >= MIN_SAMPLE_SIZE &&
      premiumDirect.usesCount >= MIN_SAMPLE_SIZE &&
      trustRate - directRate >= MIN_RATE_DELTA
    ) {
      insights.push({
        category: OptimizationInsightCategory.OBJECTION,
        title: 'Value framing resolves price objections better',
        description: `Trust-building, fit-focused replies are starting more orders after price objections than premium-direct replies, at ${(trustRate * 100).toFixed(1)}% versus ${(directRate * 100).toFixed(1)}%.`,
        confidence: Math.min(0.92, 0.56 + trustBuilding.usesCount / 100),
        impactLevel: 'high',
        supportingDataJson: {
          trustBuilding,
          premiumDirect,
        } satisfies Prisma.InputJsonObject,
      });
    }
  }

  const topOverride = args.humanOverrideStats[0];

  if (topOverride && topOverride.count >= MIN_SAMPLE_SIZE) {
    insights.push({
      category: OptimizationInsightCategory.HUMAN_OVERRIDE,
      title: `${topOverride.correctionType} is the top human override`,
      description: `${topOverride.correctionType} is the most common correction pattern in recent human feedback, indicating the agent should be reviewed on that path first.`,
      confidence: Math.min(0.88, 0.5 + topOverride.count / 100),
      impactLevel: topOverride.count >= 10 ? 'high' : 'medium',
      supportingDataJson: {
        topOverride,
      } satisfies Prisma.InputJsonObject,
    });
  }

  for (const experiment of args.experimentResults) {
    if (!experiment.winningVariant || experiment.sampleSize < MIN_SAMPLE_SIZE) {
      continue;
    }

    const winningUsers = experiment.winningVariant === 'A' ? experiment.variantAUsers : experiment.variantBUsers;
    const winningWins = experiment.winningVariant === 'A' ? experiment.variantAWins : experiment.variantBWins;
    const winningRate = toRate(winningWins, winningUsers);

    insights.push({
      category: OptimizationInsightCategory.EXPERIMENT,
      title: `${experiment.name} has a leading variant`,
      description: `Variant ${experiment.winningVariant} is currently leading ${experiment.name} with ${(winningRate * 100).toFixed(1)}% win rate across ${winningUsers} assignments.`,
      confidence: Math.min(0.94, 0.55 + experiment.sampleSize / 100),
      impactLevel: experiment.sampleSize >= 20 ? 'high' : 'medium',
      supportingDataJson: {
        experiment,
      } satisfies Prisma.InputJsonObject,
    });
  }

  return insights;
}

export class OptimizationService {
  private prisma = getPrismaClient();

  async createExperiment(input: {
    name: string;
    type: ExperimentType;
    status?: ExperimentStatus;
    variantA: Prisma.InputJsonValue;
    variantB: Prisma.InputJsonValue;
    audienceRuleJson?: Prisma.InputJsonValue | null;
    startedAt?: Date | null;
    endedAt?: Date | null;
  }) {
    return this.prisma.experiment.create({
      data: {
        name: input.name.trim(),
        type: input.type,
        status: input.status ?? ExperimentStatus.DRAFT,
        variantA: input.variantA,
        variantB: input.variantB,
        ...(input.audienceRuleJson !== undefined
          ? {
              audienceRuleJson:
                input.audienceRuleJson === null ? Prisma.JsonNull : input.audienceRuleJson,
            }
          : {}),
        startedAt: input.startedAt ?? null,
        endedAt: input.endedAt ?? null,
      },
    });
  }

  async updateExperiment(
    experimentId: string,
    input: {
      name?: string;
      status?: ExperimentStatus;
      variantA?: Prisma.InputJsonValue;
      variantB?: Prisma.InputJsonValue;
      audienceRuleJson?: Prisma.InputJsonValue | null;
      startedAt?: Date | null;
      endedAt?: Date | null;
    }
  ) {
    return this.prisma.experiment.update({
      where: {
        id: experimentId,
      },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.variantA !== undefined ? { variantA: input.variantA } : {}),
        ...(input.variantB !== undefined ? { variantB: input.variantB } : {}),
        ...(input.audienceRuleJson !== undefined
          ? {
              audienceRuleJson:
                input.audienceRuleJson === null ? Prisma.JsonNull : input.audienceRuleJson,
            }
          : {}),
        ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
        ...(input.endedAt !== undefined ? { endedAt: input.endedAt } : {}),
      },
    });
  }

  async listExperiments() {
    return this.prisma.experiment.findMany({
      include: {
        assignments: true,
      },
      orderBy: [
        {
          status: 'asc',
        },
        {
          createdAt: 'desc',
        },
      ],
    });
  }

  async listInsights(limit = 50) {
    return this.prisma.optimizationInsight.findMany({
      orderBy: [
        {
          createdAt: 'desc',
        },
      ],
      take: limit,
    });
  }

  private async upsertInsight(insight: InsightDraft) {
    const existing = await this.prisma.optimizationInsight.findFirst({
      where: {
        category: insight.category,
        title: insight.title,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (existing) {
      return this.prisma.optimizationInsight.update({
        where: {
          id: existing.id,
        },
        data: {
          description: insight.description,
          confidence: insight.confidence,
          impactLevel: insight.impactLevel,
          ...(insight.supportingDataJson !== undefined
            ? {
                supportingDataJson:
                  insight.supportingDataJson === null
                    ? Prisma.JsonNull
                    : insight.supportingDataJson,
              }
            : {}),
          status:
            existing.status === OptimizationInsightStatus.DISMISSED
              ? OptimizationInsightStatus.DISMISSED
              : OptimizationInsightStatus.OPEN,
        },
      });
    }

    return this.prisma.optimizationInsight.create({
      data: {
        category: insight.category,
        title: insight.title,
        description: insight.description,
        confidence: insight.confidence,
        impactLevel: insight.impactLevel,
        ...(insight.supportingDataJson !== undefined
          ? {
              supportingDataJson:
                insight.supportingDataJson === null
                  ? Prisma.JsonNull
                  : insight.supportingDataJson,
            }
          : {}),
      },
    });
  }

  async runDailyOptimizationCycle(asOf = new Date()) {
    const [analyticsEvents, experiments, humanFeedbackEvents] = await Promise.all([
      this.prisma.analyticsEvent.findMany({
        where: {
          eventType: {
            in: [
              'reply_strategy_used',
              'follow_up_scheduled',
              'follow_up_sent',
              'human_feedback_recorded',
              'outcome_engaged',
              'outcome_follow_up_replied',
              'outcome_order_started',
              'outcome_payment_submitted',
              'outcome_order_confirmed',
              'outcome_reordered',
              'outcome_human_takeover',
              'outcome_human_closed_successfully',
            ],
          },
        },
        orderBy: [
          {
            conversationId: 'asc',
          },
          {
            createdAt: 'asc',
          },
        ],
      }),
      this.prisma.experiment.findMany({
        include: {
          assignments: true,
        },
      }),
      this.prisma.humanFeedbackEvent.findMany(),
    ]);

    const strategyRows = buildStrategyPerformanceRows(analyticsEvents, asOf);
    const recommendationRows = buildRecommendationPerformance(analyticsEvents);
    const followUpRows = buildFollowUpPerformance(analyticsEvents);
    const experimentResults = buildExperimentResults(experiments);
    const humanOverrideStats = buildHumanOverrideStats(humanFeedbackEvents);
    const insights = buildOptimizationInsights({
      strategyRows,
      recommendationRows,
      followUpRows,
      experimentResults,
      humanOverrideStats,
    });

    for (const row of strategyRows) {
      await this.prisma.strategyPerformance.upsert({
        where: {
          strategyName_intentType_buyerSegment_channel: {
            strategyName: row.strategyName,
            intentType: row.intentType,
            buyerSegment: row.buyerSegment,
            channel: row.channel,
          },
        },
        create: row,
        update: {
          usesCount: row.usesCount,
          responseCount: row.responseCount,
          orderStartCount: row.orderStartCount,
          paymentSubmitCount: row.paymentSubmitCount,
          confirmedOrderCount: row.confirmedOrderCount,
          dropOffCount: row.dropOffCount,
          followUpSentCount: row.followUpSentCount,
          followUpReplyCount: row.followUpReplyCount,
          reorderCount: row.reorderCount,
          humanOverrideCount: row.humanOverrideCount,
        },
      });
    }

    for (const insight of insights) {
      await this.upsertInsight(insight);
    }

    logger.info('optimization.cycle.completed', {
      strategyRows: strategyRows.length,
      insights: insights.length,
      experiments: experimentResults.length,
    });

    return {
      generatedAt: asOf.toISOString(),
      strategyRowsUpdated: strategyRows.length,
      recommendationRows: recommendationRows.length,
      followUpRows: followUpRows.length,
      insightsUpserted: insights.length,
      experimentsReviewed: experimentResults.length,
      humanOverrideSignals: humanOverrideStats.length,
    };
  }

  async getDashboardSummary(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [strategyRows, recentEvents, experiments, insights, humanFeedbackEvents] = await Promise.all([
      this.prisma.strategyPerformance.findMany({
        orderBy: [
          {
            confirmedOrderCount: 'desc',
          },
          {
            usesCount: 'desc',
          },
        ],
        take: 25,
      }),
      this.prisma.analyticsEvent.findMany({
        where: {
          createdAt: {
            gte: since,
          },
          eventType: {
            in: [
              'reply_strategy_used',
              'follow_up_scheduled',
              'follow_up_sent',
              'outcome_engaged',
              'outcome_follow_up_replied',
              'outcome_order_started',
              'outcome_payment_submitted',
              'outcome_order_confirmed',
              'outcome_reordered',
            ],
          },
        },
        orderBy: [
          {
            conversationId: 'asc',
          },
          {
            createdAt: 'asc',
          },
        ],
      }),
      this.prisma.experiment.findMany({
        include: {
          assignments: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.optimizationInsight.findMany({
        where: {
          status: {
            in: [OptimizationInsightStatus.OPEN, OptimizationInsightStatus.REVIEWED],
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 20,
      }),
      this.prisma.humanFeedbackEvent.findMany({
        where: {
          createdAt: {
            gte: since,
          },
        },
      }),
    ]);

    const recommendationRows = buildRecommendationPerformance(recentEvents);
    const followUpRows = buildFollowUpPerformance(recentEvents);
    const experimentResults = buildExperimentResults(experiments);
    const humanOverrideStats = buildHumanOverrideStats(humanFeedbackEvents);
    const segmentComparison = Array.from(
      strategyRows.reduce<Map<string, { usesCount: number; confirmedOrderCount: number }>>((accumulator, row) => {
        const current = accumulator.get(row.buyerSegment) ?? {
          usesCount: 0,
          confirmedOrderCount: 0,
        };

        current.usesCount += row.usesCount;
        current.confirmedOrderCount += row.confirmedOrderCount;
        accumulator.set(row.buyerSegment, current);
        return accumulator;
      }, new Map())
    ).map(([buyerSegment, metrics]) => ({
      buyerSegment,
      usesCount: metrics.usesCount,
      confirmedOrderCount: metrics.confirmedOrderCount,
      confirmedRate: toRate(metrics.confirmedOrderCount, metrics.usesCount),
    }));

    return {
      generatedAt: new Date().toISOString(),
      scorecards: {
        replyStrategies: strategyRows,
        recommendations: recommendationRows,
        followUps: followUpRows,
        humanOverrides: humanOverrideStats,
        experiments: experimentResults,
        segments: segmentComparison,
      },
      insights,
    };
  }
}

export const optimizationService = new OptimizationService();
