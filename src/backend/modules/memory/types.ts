import type { IntentType } from '@/backend/modules/ai/intent.service';
import type { NextAction } from '@/backend/modules/ai/nba.service';

export type MemoryLanguage = 'english' | 'hinglish' | 'hindi' | 'mixed';
export type MemoryBuyerType = 'personal' | 'gifting' | 'bulk' | 'repeat';
export type MemorySize = 'medium' | 'large' | 'jumbo';
export type PreferredContactStyle = 'whatsapp' | 'call' | 'summary_first' | 'direct';

export type CustomerMemoryProfile = {
  customerId: string;
  name?: string;
  phone: string;
  city?: string;
  state?: string;
  preferredLanguage?: MemoryLanguage;
  repeatCustomer: boolean;
  buyerType?: MemoryBuyerType;
  preferredSize?: MemorySize;
  averageQuantityDozen?: number;
  priceSensitive?: boolean;
  trustFocused?: boolean;
  prefersRecommendations?: boolean;
  prefersShortReplies?: boolean;
  asksDeliveryOften?: boolean;
  asksPriceFirstOften?: boolean;
  usuallyPaysFast?: boolean;
  lastOrderDate?: string;
  lastOrderSize?: MemorySize;
  lastOrderQuantityDozen?: number;
  lastOrderValue?: number;
  lastKnownAddress?: string;
  preferredContactStyle?: PreferredContactStyle;
  notes?: string[];
  updatedAt: string;
};

export type LeadScoreTrend = 'rising' | 'stable' | 'cooling';
export type FollowUpPerformance = 'strong' | 'mixed' | 'weak' | 'unknown';
export type PaymentBehavior = 'fast' | 'steady' | 'slow' | 'unknown';
export type RepeatGuardState = 'clear' | 'watch' | 'break';

export type SalesMemoryState = {
  currentLeadStage: string;
  buyerType?: MemoryBuyerType;
  leadScoreTrend: LeadScoreTrend;
  followUpSuccess: FollowUpPerformance;
  objectionHistory: string[];
  commonQuestions: string[];
  lastQuoteGiven?: number;
  paymentBehavior: PaymentBehavior;
  lastKnownDeliveryCity?: string;
  lastOrderValue?: number;
  currentLeadScore?: number;
};

export type SessionMemoryState = {
  latestUserIntent?: IntentType;
  pendingClarification?: string;
  repeatGuardState: RepeatGuardState;
  currentDraftSummary?: string;
  restartRequested: boolean;
  lastBotAction?: NextAction;
  orderEditContext?: string;
};

export type PersonalizationContext = {
  isRepeat: boolean;
  isVip: boolean;
  vipScore: number;
  preferredSize?: MemorySize;
  buyerType?: MemoryBuyerType;
  priceSensitive?: boolean;
  shouldUseShortReplies: boolean;
  likelyNeedsRecommendation: boolean;
  usuallyPaysFast: boolean;
  reorderHint?: string;
  preferredContactStyle?: PreferredContactStyle;
};

export type MemoryContextSnapshot = {
  profile: CustomerMemoryProfile;
  sales: SalesMemoryState;
  session: SessionMemoryState;
  personalization: PersonalizationContext;
  conversationSummary: string;
};
