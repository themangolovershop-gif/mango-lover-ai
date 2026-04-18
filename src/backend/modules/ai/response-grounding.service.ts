import type { ToolExecutionContext, ToolExecutionResult } from '@/backend/modules/tools/tool.types';
import { toolExecutorService } from '@/backend/modules/tools/tool-executor.service';
import { toolRouterService } from '@/backend/modules/tools/tool-router.service';

export type ResponseGroundingContext = {
  toolPlanSummary: string[];
  toolResults: ToolExecutionResult[];
  groundedReplyHint?: string;
  groundingRules: string[];
};

const REPLY_HINT_PRIORITY: Array<ToolExecutionResult['name']> = [
  'restart_order_session',
  'update_order_quantity',
  'update_order_size',
  'update_order_address',
  'create_draft_order',
  'reorder_last_order',
  'get_payment_status',
  'get_current_order_summary',
  'get_quote',
  'get_last_successful_order',
  'search_mango_knowledge',
  'search_business_knowledge',
  'get_product_by_size',
  'get_delivery_charge',
  'escalate_to_human',
];

function pickGroundedReplyHint(toolResults: ToolExecutionResult[]) {
  for (const toolName of REPLY_HINT_PRIORITY) {
    const match = toolResults.find((result) => result.name === toolName && result.replyHint);

    if (match?.replyHint) {
      return match.replyHint;
    }
  }

  return undefined;
}

export class ResponseGroundingService {
  async buildGroundingContext(context: ToolExecutionContext): Promise<ResponseGroundingContext> {
    const plan = toolRouterService.decideToolPlan(context);
    const toolResults = await toolExecutorService.executePlan(plan, context);

    return {
      toolPlanSummary: plan.tools.map((tool) => `${tool.name}: ${tool.reason}`),
      toolResults,
      groundedReplyHint: pickGroundedReplyHint(toolResults),
      groundingRules: [
        'Do not guess live order or payment data when tool results are available.',
        'Do not guess pricing when quote tools are available.',
        'Do not invent stock or delivery coverage without configured data.',
        'Prefer tool and database truth over prompt memory.',
      ],
    };
  }
}

export const responseGroundingService = new ResponseGroundingService();
