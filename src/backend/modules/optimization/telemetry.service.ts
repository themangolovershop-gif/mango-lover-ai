import {
  ConversationChannel,
  ExperimentStatus,
  ExperimentType,
  type Experiment,
  type Prisma,
} from '@prisma/client';

import { getPrismaClient } from '@/backend/shared/lib/prisma';
import { normalizeMessage } from '@/backend/shared/utils/normalization';

import type {
  BuyerSegmentKey,
  ExperimentAssignmentSummary,
  ExperimentVariantPayload,
  FollowUpOptimizationInput,
  FollowUpOptimizationSelection,
  RecordHumanFeedbackInput,
  RecordOutcomeInput,
  RecordReplyStrategyUsageInput,
  ReplyStrategyName,
  ReplyStrategySelection,
  ReplyStrategySelectionInput,
} from './types';

type AudienceRule = {
  buyerSegments?: string[];
  intentTypes?: string[];
  channels?: string[];
  leadStages?: string[];
  followUpTypes?: string[];
};

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function normalizeKey(value?: string | null) {
  return normalizeMessage(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeAudienceRule(value: Prisma.JsonValue | null | undefined): AudienceRule {
  const record = asRecord(value);

  if (!record) {
    return {};
  }

  return {
    buyerSegments: asStringArray(record.buyerSegments),
    intentTypes: asStringArray(record.intentTypes),
    channels: asStringArray(record.channels),
    leadStages: asStringArray(record.leadStages),
    followUpTypes: asStringArray(record.followUpTypes),
  };
}

function parseVariantPayload(value: Prisma.JsonValue): ExperimentVariantPayload {
  const record = asRecord(value);

  if (!record) {
    return {};
  }

  return {
    label: typeof record.label === 'string' ? record.label.trim() : undefined,
    promptHint: typeof record.promptHint === 'string' ? record.promptHint.trim() : undefined,
    delayHours:
      typeof record.delayHours === 'number'
        ? record.delayHours
        : typeof record.delayHours === 'string' && record.delayHours.trim()
        ? Number(record.delayHours)
          : undefined,
  };
}

function stableVariant(seed: string) {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return hash % 2 === 0 ? 'A' : 'B';
}

export function isPriceObjectionMessage(message: string) {
  const normalized = normalizeKey(message);
  return ['expensive', 'discount', 'cheaper', 'last price', 'best price', 'budget'].some((term) =>
    normalized.includes(term)
  );
}

export function deriveBuyerSegment(input: {
  buyerType: string;
  memorySnapshot?: ReplyStrategySelectionInput['memorySnapshot'];
}): BuyerSegmentKey {
  const profile = input.memorySnapshot?.profile;
  const personalization = input.memorySnapshot?.personalization;

  if (personalization?.isVip) {
    return 'vip_buyer';
  }

  if (profile?.priceSensitive) {
    return 'price_sensitive';
  }

  if (input.buyerType === 'bulk') {
    return 'bulk_buyer';
  }

  if (input.buyerType === 'gifting') {
    return 'gifting_buyer';
  }

  if (profile?.repeatCustomer || input.buyerType === 'repeat') {
    return 'repeat_buyer';
  }

  return 'new_buyer';
}

function deriveRecommendedSize(input: ReplyStrategySelectionInput) {
  const toolSize = input.groundingSnapshot?.toolResults.find((result) => {
    const data = asRecord(result.data);
    return typeof data?.size === 'string';
  });
  const toolData = toolSize ? (asRecord(toolSize.data) ?? {}) : {};

  return (
    input.entities.size ??
    (typeof toolData.size === 'string' ? toolData.size : undefined) ??
    input.memorySnapshot?.profile.preferredSize
  );
}

export function deriveReplyStrategy(input: ReplyStrategySelectionInput): ReplyStrategyName {
  const primaryAgent = input.agentSnapshot?.decision.primaryAgent;
  const personalization = input.memorySnapshot?.personalization;

  if (primaryAgent === 'recovery') {
    return 'recovery_guard';
  }

  if (primaryAgent === 'order_ops') {
    return input.intents.includes('repeat_order') ? 'reorder_soft' : 'order_ops_grounded';
  }

  if (primaryAgent === 'mango_expert') {
    return 'education_first';
  }

  if (personalization?.isVip) {
    return 'vip_concierge';
  }

  if (input.nextAction === 'REQUEST_PAYMENT') {
    return 'payment_closer';
  }

  if (input.intents.includes('recommendation_request')) {
    return 'consultative_recommend';
  }

  if (input.intents.includes('repeat_order')) {
    return 'reorder_soft';
  }

  if (isPriceObjectionMessage(input.latestMessage)) {
    return 'trust_building';
  }

  if (input.intents.includes('pricing')) {
    return 'premium_direct';
  }

  return 'premium_soft';
}

function getReplyExperimentTypes(input: ReplyStrategySelectionInput) {
  const experimentTypes = new Set<ExperimentType>();

  if (input.intents.includes('recommendation_request')) {
    experimentTypes.add(ExperimentType.RECOMMENDATION_COPY);
  }

  if (isPriceObjectionMessage(input.latestMessage)) {
    experimentTypes.add(ExperimentType.PRICE_OBJECTION_COPY);
  }

  if (input.intents.includes('repeat_order') || input.nextAction === 'CONFIRM_ORDER') {
    experimentTypes.add(ExperimentType.REORDER_REMINDER_COPY);
  }

  if (input.nextAction === 'REQUEST_PAYMENT') {
    experimentTypes.add(ExperimentType.PAYMENT_REMINDER_COPY);
  }

  return Array.from(experimentTypes);
}

function matchesAudience(args: {
  experiment: Experiment;
  buyerSegment: BuyerSegmentKey;
  intentTypes: string[];
  channel: ConversationChannel;
  leadStage: string;
  followUpType?: string;
}) {
  const audience = normalizeAudienceRule(args.experiment.audienceRuleJson);

  if (audience.buyerSegments?.length && !audience.buyerSegments.includes(args.buyerSegment)) {
    return false;
  }

  if (
    audience.intentTypes?.length &&
    !args.intentTypes.some((intentType) => audience.intentTypes?.includes(intentType))
  ) {
    return false;
  }

  if (
    audience.channels?.length &&
    !audience.channels.includes(args.channel)
  ) {
    return false;
  }

  if (
    audience.leadStages?.length &&
    !audience.leadStages.includes(args.leadStage)
  ) {
    return false;
  }

  if (
    args.followUpType &&
    audience.followUpTypes?.length &&
    !audience.followUpTypes.includes(args.followUpType)
  ) {
    return false;
  }

  return true;
}

export class OptimizationTelemetryService {
  private prisma = getPrismaClient();

  private async assignExperiment(args: {
    experiment: Experiment;
    customerId: string;
    conversationId: string;
  }): Promise<ExperimentAssignmentSummary> {
    const existing = await this.prisma.experimentAssignment.findUnique({
      where: {
        experimentId_conversationId: {
          experimentId: args.experiment.id,
          conversationId: args.conversationId,
        },
      },
    });
    const variant = (existing?.variant as 'A' | 'B' | null) ?? stableVariant(`${args.experiment.id}:${args.conversationId}`);
    const payload = parseVariantPayload(
      variant === 'A' ? args.experiment.variantA : args.experiment.variantB
    );

    if (!existing) {
      const assignmentMetadata = {
        ...(payload.label !== undefined ? { label: payload.label } : {}),
        ...(payload.promptHint !== undefined ? { promptHint: payload.promptHint } : {}),
        ...(payload.delayHours !== undefined ? { delayHours: payload.delayHours } : {}),
      } as Prisma.InputJsonObject;

      await this.prisma.experimentAssignment.create({
        data: {
          experimentId: args.experiment.id,
          customerId: args.customerId,
          conversationId: args.conversationId,
          variant,
          metadataJson: assignmentMetadata,
        },
      });
    }

    return {
      experimentId: args.experiment.id,
      name: args.experiment.name,
      type: args.experiment.type,
      variant,
      label: payload.label,
      promptHint: payload.promptHint,
      delayHours: payload.delayHours,
    };
  }

  async selectReplyStrategyContext(
    input: ReplyStrategySelectionInput
  ): Promise<ReplyStrategySelection> {
    const buyerSegment = deriveBuyerSegment({
      buyerType: input.buyerType,
      memorySnapshot: input.memorySnapshot,
    });
    const strategyName = deriveReplyStrategy(input);
    const channel = input.channel ?? ConversationChannel.WHATSAPP;
    const experimentTypes = getReplyExperimentTypes(input);
    const experiments =
      experimentTypes.length > 0
        ? await this.prisma.experiment.findMany({
            where: {
              status: ExperimentStatus.ACTIVE,
              type: {
                in: experimentTypes,
              },
            },
            orderBy: {
              createdAt: 'asc',
            },
          })
        : [];

    const experimentAssignments: ExperimentAssignmentSummary[] = [];

    for (const experiment of experiments) {
      if (
        !matchesAudience({
          experiment,
          buyerSegment,
          intentTypes: input.intents,
          channel,
          leadStage: input.leadStage,
        })
      ) {
        continue;
      }

      experimentAssignments.push(
        await this.assignExperiment({
          experiment,
          customerId: input.customerId,
          conversationId: input.conversationId,
        })
      );
    }

    const optimizationHints = Array.from(
      new Set(
        experimentAssignments
          .map((assignment) => assignment.promptHint)
          .filter((value): value is string => Boolean(value))
      )
    );
    const toolNames =
      input.groundingSnapshot?.toolResults.map((result) => result.name) ?? [];
    const agentPath =
      input.agentSnapshot?.results.map((result) => result.agent) ?? [];
    const recommendedSize = deriveRecommendedSize(input);

    return {
      strategyName,
      intentType: input.primaryIntent,
      buyerSegment,
      channel,
      optimizationHints,
      experimentAssignments,
      metadata: {
        nextAction: input.nextAction,
        leadStage: input.leadStage,
        buyerType: input.buyerType,
        city: input.entities.city ?? input.memorySnapshot?.profile.city ?? null,
        recommendedSize: recommendedSize ?? null,
        agentPath,
        toolsCalled: toolNames,
        objectionType: isPriceObjectionMessage(input.latestMessage) ? 'price' : null,
      },
    };
  }

  async selectFollowUpOptimization(
    input: FollowUpOptimizationInput
  ): Promise<FollowUpOptimizationSelection> {
    const experiments = await this.prisma.experiment.findMany({
      where: {
        status: ExperimentStatus.ACTIVE,
        type: ExperimentType.FOLLOW_UP_TIMING,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const experimentAssignments: ExperimentAssignmentSummary[] = [];
    let delayHoursOverride: number | undefined;

    for (const experiment of experiments) {
      if (
        !matchesAudience({
          experiment,
          buyerSegment: input.buyerSegment,
          intentTypes: [],
          channel: ConversationChannel.WHATSAPP,
          leadStage: input.leadStage,
          followUpType: input.followUpType,
        })
      ) {
        continue;
      }

      const assignment = await this.assignExperiment({
        experiment,
        customerId: input.customerId,
        conversationId: input.conversationId,
      });

      experimentAssignments.push(assignment);

      if (delayHoursOverride === undefined && typeof assignment.delayHours === 'number') {
        delayHoursOverride = assignment.delayHours;
      }
    }

    return {
      delayHoursOverride,
      experimentAssignments,
      analyticsPayload: {
        buyerSegment: input.buyerSegment,
        followUpType: input.followUpType,
        timingExperiments: experimentAssignments.map((assignment) => ({
          experimentId: assignment.experimentId,
          name: assignment.name,
          variant: assignment.variant,
          delayHours: assignment.delayHours ?? null,
        })),
      },
    };
  }

  async recordReplyStrategyUsage(input: RecordReplyStrategyUsageInput) {
    await this.prisma.analyticsEvent.create({
      data: {
        customerId: input.customerId,
        conversationId: input.conversationId,
        leadId: input.leadId,
        orderId: input.orderId ?? null,
        eventType: 'reply_strategy_used',
        payloadJson: {
          phone: input.phone,
          replyText: input.replyText,
          replyLength: input.replyText.length,
          providerMessageId: input.providerMessageId ?? null,
          strategyName: input.selection.strategyName,
          intentType: input.selection.intentType,
          buyerSegment: input.selection.buyerSegment,
          channel: input.selection.channel,
          optimizationHints: input.selection.optimizationHints,
          experimentAssignments: input.selection.experimentAssignments,
          ...input.selection.metadata,
        } satisfies Prisma.InputJsonObject,
      },
    });
  }

  async recordOutcome(input: RecordOutcomeInput) {
    await this.prisma.analyticsEvent.create({
      data: {
        customerId: input.customerId ?? null,
        conversationId: input.conversationId,
        leadId: input.leadId ?? null,
        orderId: input.orderId ?? null,
        eventType: `outcome_${input.label}`,
        payloadJson: (input.payload ?? {}) as Prisma.InputJsonObject,
      },
    });

    await this.prisma.experimentAssignment.updateMany({
      where: {
        conversationId: input.conversationId,
        outcomeLabel: null,
        experiment: {
          status: {
            in: [ExperimentStatus.ACTIVE, ExperimentStatus.COMPLETED],
          },
        },
      },
      data: {
        outcomeLabel: input.label,
      },
    });
  }

  async recordHumanFeedback(input: RecordHumanFeedbackInput) {
    const feedback = await this.prisma.humanFeedbackEvent.create({
      data: {
        conversationId: input.conversationId,
        customerId: input.customerId ?? null,
        messageId: input.messageId ?? null,
        aiSuggestionType: input.aiSuggestionType,
        aiSuggestedReply: input.aiSuggestedReply ?? null,
        humanFinalReply: input.humanFinalReply ?? null,
        correctionType: input.correctionType,
        reason: input.reason ?? null,
        ...(input.metadata ? { metadataJson: input.metadata as Prisma.InputJsonObject } : {}),
      },
    });

    await this.prisma.analyticsEvent.create({
      data: {
        customerId: input.customerId ?? null,
        conversationId: input.conversationId,
        eventType: 'human_feedback_recorded',
        payloadJson: {
          correctionType: input.correctionType,
          aiSuggestionType: input.aiSuggestionType,
          reason: input.reason ?? null,
        } satisfies Prisma.InputJsonObject,
      },
    });

    if (input.correctionType === 'HUMAN_TAKEOVER') {
      await this.recordOutcome({
        customerId: input.customerId ?? null,
        conversationId: input.conversationId,
        label: 'human_takeover',
        payload: {
          aiSuggestionType: input.aiSuggestionType,
          reason: input.reason ?? null,
        },
      });
    }

    return feedback;
  }
}

export const optimizationTelemetryService = new OptimizationTelemetryService();
