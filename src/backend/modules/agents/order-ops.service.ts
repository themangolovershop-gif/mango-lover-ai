import type { ToolExecutionResult } from '@/backend/modules/tools/tool.types';

import type { AgentContext, AgentResult } from './types';

function getToolResult(
  context: AgentContext,
  names: ToolExecutionResult['name'][]
) {
  return context.groundingSnapshot?.toolResults.find((result) => names.includes(result.name));
}

export class OrderOpsAgent {
  async respond(context: AgentContext): Promise<AgentResult> {
    const priorityTools: ToolExecutionResult['name'][][] = [
      ['restart_order_session'],
      ['update_order_quantity'],
      ['update_order_size'],
      ['update_order_address'],
      ['reorder_last_order'],
      ['create_draft_order'],
      ['get_payment_status'],
      ['mark_payment_submitted'],
      ['get_current_order_summary'],
      ['get_last_successful_order'],
    ];

    for (const names of priorityTools) {
      const result = getToolResult(context, names);

      if (result?.replyHint) {
        return {
          agent: 'order_ops',
          summary: result.summary,
          replyHint: result.replyHint,
          confidence: result.ok ? 0.99 : 0.82,
          recommendedAction: context.nextAction,
        };
      }
    }

    if (context.orderSummary) {
      return {
        agent: 'order_ops',
        summary: 'Used the current order summary already present in context.',
        replyHint: `${context.orderSummary} Tell me if you want to confirm it or change anything.`,
        confidence: 0.8,
        recommendedAction: context.nextAction,
      };
    }

    return {
      agent: 'order_ops',
      summary: 'No live order data was available.',
      replyHint: 'I do not see an active order draft yet. If you want, I can help you start one or review your last successful order.',
      confidence: 0.68,
      recommendedAction: 'COLLECT_QUANTITY_AND_CITY',
    };
  }
}
