import type { PaymentStatus } from '@prisma/client';

import type { ExtractedEntities } from '@/backend/modules/ai/entity.service';
import type { IntentType } from '@/backend/modules/ai/intent.service';
import type { NextAction } from '@/backend/modules/ai/nba.service';
import type { MemoryContextSnapshot } from '@/backend/modules/memory/types';
import type { getLatestConversationOrder } from '@/backend/modules/orders/order.service';

export type ConversationOrder = Awaited<ReturnType<typeof getLatestConversationOrder>>;

export type ToolName =
  | 'get_current_order_summary'
  | 'create_draft_order'
  | 'update_order_quantity'
  | 'update_order_size'
  | 'update_order_address'
  | 'restart_order_session'
  | 'confirm_order'
  | 'get_payment_status'
  | 'mark_payment_submitted'
  | 'verify_payment'
  | 'get_product_by_size'
  | 'get_catalog_overview'
  | 'get_quote'
  | 'get_delivery_charge'
  | 'get_customer_memory'
  | 'get_lead_status'
  | 'update_customer_memory'
  | 'schedule_followup'
  | 'escalate_to_human'
  | 'get_order_history'
  | 'get_last_successful_order'
  | 'reorder_last_order'
  | 'search_mango_knowledge'
  | 'search_business_knowledge';

export type ToolInvocation = {
  name: ToolName;
  args?: Record<string, unknown>;
  reason: string;
};

export type ToolPlan = {
  tools: ToolInvocation[];
  reasons: string[];
  requiresLiveData: boolean;
};

export type ToolExecutionContext = {
  customerId: string;
  conversationId: string;
  leadId: string;
  phone: string;
  leadStage: string;
  buyerType: string;
  nextAction: NextAction;
  intents: IntentType[];
  entities: ExtractedEntities;
  latestUserMessage: string;
  latestOrder: ConversationOrder | null;
  paymentStatus: PaymentStatus;
  memorySnapshot?: MemoryContextSnapshot | null;
};

export type ToolExecutionResult = {
  name: ToolName;
  ok: boolean;
  summary: string;
  replyHint?: string;
  data?: Record<string, unknown> | string[] | null;
};
