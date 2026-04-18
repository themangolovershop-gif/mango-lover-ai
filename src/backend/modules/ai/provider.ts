import type { ExtractedEntities } from './entity.service';
import type {
  CustomerMemoryProfile,
  PersonalizationContext,
  SalesMemoryState,
  SessionMemoryState,
} from '@/backend/modules/memory/types';
import type { ToolExecutionResult } from '@/backend/modules/tools/tool.types';

export interface AIProvider {
  generateCompletion(prompt: string, options?: Record<string, unknown>): Promise<string>;
}

export interface AIReplyContext {
  customerName?: string;
  phone: string;
  leadStage: string;
  buyerType: string;
  intents: string[];
  entities: ExtractedEntities;
  nextAction: string;
  orderSummary?: string;
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
