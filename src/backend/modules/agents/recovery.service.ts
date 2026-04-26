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
            ? "I've cleared our session. We're starting completely fresh - how can I assist you now?"
            : restartResult?.replyHint ?? "Understood. Let's begin fresh. Tell me the size and quantity you're looking for, and I'll guide you.",
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
          "I'm escalating this to our human team immediately to ensure it gets the attention it deserves. Please bear with us for a moment.",
        confidence: 1,
        recommendedAction: 'ESCALATE_HUMAN',
      };
    }

    if (repeatGuard === 'break' || repeatedReplies) {
      return {
        agent: 'recovery',
        summary: 'Breaking a stuck conversational loop.',
        replyHint: context.latestOrder
          ? "Let me get this right - would you like to continue with your current order, make a change, or should we start fresh?"
          : "I want to make sure I'm helping you the right way. Would you prefer a recommendation, a quote, or to start a fresh order?",
        confidence: 0.94,
        recommendedAction: context.nextAction,
      };
    }

    return {
      agent: 'recovery',
      summary: 'Provided general recovery guidance.',
      replyHint: "I'm here to guide you. Just tell me if you'd like to continue, make a change, or start fresh.",
      confidence: 0.72,
      recommendedAction: context.nextAction,
    };


  }
}
