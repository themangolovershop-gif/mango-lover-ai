import type { ToolExecutionResult } from '@/backend/modules/tools/tool.types';

import type { AgentContext, AgentResult } from './types';

function getToolResult(
  context: AgentContext,
  names: ToolExecutionResult['name'][]
) {
  return context.groundingSnapshot?.toolResults.find((result) => names.includes(result.name));
}

function hasDuplicateReplies(replies: string[]) {
  const normalized = replies
    .map((reply) =>
      reply
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);

  return new Set(normalized).size !== normalized.length;
}

export class RecoveryAgent {
  async respond(context: AgentContext): Promise<AgentResult> {
    const intents = context.intents;
    const restartResult = getToolResult(context, ['restart_order_session']);
    const escalationResult = getToolResult(context, ['escalate_to_human']);
    const repeatGuard = context.memorySnapshot?.session.repeatGuardState;
    const repeatedReplies = hasDuplicateReplies(context.recentAssistantReplies);
    const isReset =
      intents.includes('restart_order_request') || 
      intents.includes('cancellation') || 
      intents.includes('reset_conversation');

    if (isReset) {
      return {
        agent: 'recovery',
        summary: 'Resetting the conversation or draft order.',
        replyHint:
          intents.includes('reset_conversation')
            ? 'I have cleared our current session details. We are starting fresh—how can I help you today?'
            : restartResult?.replyHint ?? 'Understood. We can start fresh. Tell me the size and quantity you want, and I will guide you.',
        confidence: 1,
        recommendedAction: 'COLLECT_QUANTITY_AND_CITY',
      };
    }

    if (
      intents.includes('human_help_request') ||
      intents.includes('complaint') ||
      intents.includes('refund')
    ) {
      return {
        agent: 'recovery',
        summary: 'Escalating to human support.',
        replyHint:
          escalationResult?.replyHint ??
          'I am moving this to a human team member so it is handled properly. Please give us a moment.',
        confidence: 1,
        recommendedAction: 'ESCALATE_HUMAN',
      };
    }

    if (repeatGuard === 'break' || repeatedReplies) {
      return {
        agent: 'recovery',
        summary: 'Breaking a stuck conversational loop.',
        replyHint: context.latestOrder
          ? 'I may be narrowing this too much. Would you like to continue the current order, change it, or start fresh?'
          : 'I may have misunderstood slightly. Would you like pricing, a recommendation, or to start an order?',
        confidence: 0.94,
        recommendedAction: context.nextAction,
      };
    }

    return {
      agent: 'recovery',
      summary: 'Provided general recovery guidance.',
      replyHint: 'I am here to help. Tell me if you want to continue the order, change something, or start fresh.',
      confidence: 0.72,
      recommendedAction: context.nextAction,
    };
  }
}
