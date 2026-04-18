import { logger } from '@/backend/shared/lib/logger';

import type { AgentContext, AgentType, OrchestratorDecision } from './types';

function includesAny(items: readonly string[], targets: readonly string[]) {
  return targets.some((target) => items.includes(target));
}

export class OrchestratorAgent {
  async decide(context: AgentContext): Promise<OrchestratorDecision> {
    const interruptIntents = [
      'restart_order_request',
      'cancellation',
      'complaint',
      'refund',
      'human_help_request',
    ] as const;
    const orderOpsIntents = [
      'order_summary_request',
      'edit_order_request',
      'payment_update',
      'repeat_order',
      'address_submission',
    ] as const;
    const knowledgeIntents = [
      'quality_check',
      'authenticity_check',
      'delivery_check',
      'availability_check',
    ] as const;
    const salesIntents = [
      'pricing',
      'recommendation_request',
      'product_selection',
      'objection_price',
      'gifting',
      'order_start',
      'gratitude',
      'greeting',
      'unknown',
    ] as const;

    const intents = context.intents;
    const repeatGuard = context.memorySnapshot?.session.repeatGuardState;
    const hasLiveOrderTool =
      context.groundingSnapshot?.toolResults.some((result) =>
        ['get_current_order_summary', 'update_order_quantity', 'update_order_size', 'update_order_address', 'get_payment_status', 'create_draft_order', 'restart_order_session'].includes(result.name)
      ) ?? false;

    logger.info('agents.orchestrator.deciding', {
      conversationId: context.conversationId,
      intents,
      leadStage: context.leadStage,
      nextAction: context.nextAction,
      repeatGuard,
    });

    if (includesAny(intents, [...interruptIntents])) {
      return {
        primaryAgent: 'recovery',
        secondaryAgents: hasLiveOrderTool ? ['order_ops'] : [],
        reason: 'Interrupt, escalation, or reset intent detected.',
        interruptDetected: true,
      };
    }

    if (repeatGuard === 'break') {
      return {
        primaryAgent: 'recovery',
        secondaryAgents: hasLiveOrderTool ? ['order_ops'] : ['sales'],
        reason: 'Repeat guard asked to break the current conversational pattern.',
        interruptDetected: true,
      };
    }

    if (includesAny(intents, [...orderOpsIntents]) || hasLiveOrderTool) {
      const secondaryAgents: AgentType[] = [];

      if (includesAny(intents, [...knowledgeIntents])) {
        secondaryAgents.push('mango_expert');
      }

      if (includesAny(intents, [...salesIntents])) {
        secondaryAgents.push('sales');
      }

      return {
        primaryAgent: 'order_ops',
        secondaryAgents,
        reason: 'Customer asked about live order, payment, or reorder operations.',
        interruptDetected: false,
      };
    }

    if (includesAny(intents, [...knowledgeIntents])) {
      return {
        primaryAgent: 'mango_expert',
        secondaryAgents: includesAny(intents, [...salesIntents]) ? ['sales'] : [],
        reason: 'Customer asked a mango or trust-building knowledge question.',
        interruptDetected: false,
      };
    }

    return {
      primaryAgent: 'sales',
      secondaryAgents: [],
      reason: 'Defaulting to sales guidance and next-best-action support.',
      interruptDetected: false,
    };
  }
}
