import type {
  ConversationChannel,
  ExperimentType,
  HumanCorrectionType,
} from '@prisma/client';

import type { AgentProcessResult } from '@/backend/modules/agents/types';
import type { ExtractedEntities } from '@/backend/modules/ai/entity.service';
import type { IntentType } from '@/backend/modules/ai/intent.service';
import type { NextAction } from '@/backend/modules/ai/nba.service';
import type { ResponseGroundingContext } from '@/backend/modules/ai/response-grounding.service';
import type { MemoryContextSnapshot } from '@/backend/modules/memory/types';

export type ReplyStrategyName =
  | 'premium_soft'
  | 'premium_direct'
  | 'consultative_recommend'
  | 'trust_building'
  | 'payment_closer'
  | 'reorder_soft'
  | 'vip_concierge'
  | 'recovery_guard'
  | 'order_ops_grounded'
  | 'education_first';

export type BuyerSegmentKey =
  | 'new_buyer'
  | 'repeat_buyer'
  | 'gifting_buyer'
  | 'bulk_buyer'
  | 'price_sensitive'
  | 'vip_buyer';

export type OutcomeLabel =
  | 'engaged'
  | 'follow_up_replied'
  | 'order_started'
  | 'payment_submitted'
  | 'order_confirmed'
  | 'reordered'
  | 'escalated_to_human'
  | 'human_takeover'
  | 'human_closed_successfully'
  | 'no_reply';

export type ExperimentVariantPayload = {
  label?: string;
  promptHint?: string;
  delayHours?: number;
  metadata?: Record<string, unknown>;
};

export type ExperimentAssignmentSummary = {
  experimentId: string;
  name: string;
  type: ExperimentType;
  variant: 'A' | 'B';
  label?: string;
  promptHint?: string;
  delayHours?: number;
};

export type ReplyStrategySelectionInput = {
  customerId: string;
  conversationId: string;
  leadId: string;
  latestMessage: string;
  leadStage: string;
  buyerType: string;
  intents: IntentType[];
  primaryIntent: IntentType;
  nextAction: NextAction;
  entities: ExtractedEntities;
  channel?: ConversationChannel;
  memorySnapshot?: MemoryContextSnapshot | null;
  groundingSnapshot?: ResponseGroundingContext | null;
  agentSnapshot?: AgentProcessResult | null;
};

export type ReplyStrategySelection = {
  strategyName: ReplyStrategyName;
  intentType: string;
  buyerSegment: BuyerSegmentKey;
  channel: ConversationChannel;
  optimizationHints: string[];
  experimentAssignments: ExperimentAssignmentSummary[];
  metadata: Record<string, unknown>;
};

export type RecordReplyStrategyUsageInput = {
  customerId: string;
  conversationId: string;
  leadId: string;
  orderId?: string | null;
  phone: string;
  replyText: string;
  providerMessageId?: string | null;
  selection: ReplyStrategySelection;
};

export type RecordOutcomeInput = {
  customerId?: string | null;
  conversationId: string;
  leadId?: string | null;
  orderId?: string | null;
  label: OutcomeLabel;
  payload?: Record<string, unknown>;
};

export type RecordHumanFeedbackInput = {
  conversationId: string;
  customerId?: string | null;
  messageId?: string | null;
  aiSuggestionType: string;
  aiSuggestedReply?: string | null;
  humanFinalReply?: string | null;
  correctionType: HumanCorrectionType;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

export type FollowUpOptimizationInput = {
  customerId: string;
  conversationId: string;
  leadId: string;
  followUpType: string;
  leadStage: string;
  buyerSegment: BuyerSegmentKey;
  reason: string;
};

export type FollowUpOptimizationSelection = {
  delayHoursOverride?: number;
  experimentAssignments: ExperimentAssignmentSummary[];
  analyticsPayload: Record<string, unknown>;
};

export type StrategyPerformanceRowInput = {
  strategyName: string;
  intentType: string;
  buyerSegment: string;
  channel: ConversationChannel;
  usesCount: number;
  responseCount: number;
  orderStartCount: number;
  paymentSubmitCount: number;
  confirmedOrderCount: number;
  dropOffCount: number;
  followUpSentCount: number;
  followUpReplyCount: number;
  reorderCount: number;
  humanOverrideCount: number;
};

export type OptimizationExperimentResult = {
  experimentId: string;
  name: string;
  type: ExperimentType;
  status: string;
  variantAUsers: number;
  variantBUsers: number;
  variantAWins: number;
  variantBWins: number;
  winningVariant?: 'A' | 'B';
  sampleSize: number;
};

export type RecommendationPerformanceRow = {
  recommendedSize: string;
  buyerSegment: string;
  usesCount: number;
  orderStartCount: number;
  confirmedOrderCount: number;
};

export type FollowUpPerformanceRow = {
  delayBucket: string;
  scheduledCount: number;
  sentCount: number;
  replyCount: number;
  conversionCount: number;
};

export type HumanOverrideStat = {
  correctionType: string;
  count: number;
};
