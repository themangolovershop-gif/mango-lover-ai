import type { ExtractedEntities } from '@/backend/modules/ai/entity.service';
import type { IntentType } from '@/backend/modules/ai/intent.service';
import type { NextAction } from '@/backend/modules/ai/nba.service';
import type { ResponseGroundingContext } from '@/backend/modules/ai/response-grounding.service';
import type { MemoryContextSnapshot } from '@/backend/modules/memory/types';
import type { ConversationOrder } from '@/backend/modules/tools/tool.types';
import type { SalesState } from '@/lib/types';

export type AgentType = 'orchestrator' | 'sales' | 'mango_expert' | 'order_ops' | 'recovery';

export interface AgentContext {
  customerId: string;
  conversationId: string;
  leadId: string;
  customerName?: string;
  phone: string;
  latestMessage: string;
  recentHistory: string;
  lastAssistantReply?: string;
  recentAssistantReplies: string[];
  intents: IntentType[];
  primaryIntent: IntentType;
  entities: ExtractedEntities;
  leadStage: string;
  buyerType: string;
  nextAction: NextAction;
  latestOrder: ConversationOrder | null;
  orderSummary?: string;
  memorySnapshot?: MemoryContextSnapshot | null;
  groundingSnapshot?: ResponseGroundingContext | null;
}

export interface AgentResult {
  agent: AgentType;
  summary: string;
  confidence: number;
  replyHint?: string;
  followUpHint?: string;
  customerFacingDraft?: string;
  nextState?: SalesState;
  recommendedAction?: string;
  dataUsed?: Record<string, unknown>;
}

export interface OrchestratorDecision {
  primaryAgent: AgentType;
  secondaryAgents: AgentType[];
  reason: string;
  interruptDetected: boolean;
}

export interface AgentProcessResult {
  responseText: string;
  results: AgentResult[];
  decision: OrchestratorDecision;
}
