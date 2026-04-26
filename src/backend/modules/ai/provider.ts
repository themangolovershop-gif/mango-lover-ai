import type { ExtractedEntities } from './entity.service';
import type {
  CustomerMemoryProfile,
  PersonalizationContext,
  SalesMemoryState,
  SessionMemoryState,
} from '@/backend/modules/memory/types';
import type { ToolExecutionResult } from '@/backend/modules/tools/tool.types';

export type AIChatRole = 'system' | 'developer' | 'user';

export type AIChatMessage = {
  role: AIChatRole;
  content: string;
};

export type AICompletionOptions = {
  temperature?: number;
  max_tokens?: number;
};

export type AIOrderContext = {
  draftOrderExists: boolean;
  product?: string;
  quantityDozen?: number;
  deliveryCity?: string;
  orderStatus?: string;
  paymentStatus?: string;
  totalAmount?: number;
  currency?: string;
};

export interface AIProvider {
  generateCompletion(messages: AIChatMessage[], options?: AICompletionOptions): Promise<string>;
}

export interface AIReplyContext {
  customerName?: string;
  phone: string;
  leadStage: string;
  leadScore?: number;
  buyerType: string;
  intents: string[];
  entities: ExtractedEntities;
  nextAction: string;
  orderSummary?: string;
  orderContext?: AIOrderContext;
  latestUserMessage?: string;
  lastAssistantReply?: string;
  recentAssistantReplies?: string[];
  recentHistory?: string;
  customerMemoryProfile?: CustomerMemoryProfile;
  salesMemory?: SalesMemoryState;
  sessionMemory?: SessionMemoryState;
  personalization?: PersonalizationContext;
  conversationSummary?: string;
  toolPlanSummary?: string[];
  toolResults?: ToolExecutionResult[];
  groundedReplyHint?: string;
  groundingRules?: string[];
  agentDecisionReason?: string;
  agentSummaries?: string[];
  optimizationHints?: string[];
}
