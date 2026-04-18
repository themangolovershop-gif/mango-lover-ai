import type { ToolExecutionResult } from '@/backend/modules/tools/tool.types';

import type { AgentContext, AgentResult } from './types';

function getToolResult(
  context: AgentContext,
  names: ToolExecutionResult['name'][]
) {
  return context.groundingSnapshot?.toolResults.find((result) => names.includes(result.name));
}

export class SalesAgent {
  async respond(context: AgentContext): Promise<AgentResult> {
    const quoteResult = getToolResult(context, ['get_quote', 'get_product_by_size', 'get_delivery_charge']);
    const businessResult = getToolResult(context, ['search_business_knowledge']);
    const memory = context.memorySnapshot;
    const personalization = memory?.personalization;
    const intents = context.intents;

    if (quoteResult?.replyHint) {
      return {
        agent: 'sales',
        summary: 'Provided grounded pricing guidance.',
        replyHint: quoteResult.replyHint,
        confidence: 0.98,
        recommendedAction: context.nextAction,
      };
    }

    if (intents.includes('objection_price')) {
      return {
        agent: 'sales',
        summary: 'Handled price objection with value-focused positioning.',
        replyHint: personalization?.priceSensitive
          ? 'I can suggest the most suitable option based on your budget and requirement. Tell me the size or quantity you prefer, and I will guide you.'
          : businessResult?.replyHint ??
            'These are authentic GI-tagged Devgad Alphonso, naturally ripened and selected for consistency rather than mass-market pricing. If you want, I can suggest the most suitable option based on your requirement.',
        confidence: 0.95,
        recommendedAction: 'RECOMMEND_PRODUCT',
      };
    }

    if (intents.includes('recommendation_request') || intents.includes('gifting')) {
      const preferredSize = personalization?.preferredSize;
      const recommendedSize =
        intents.includes('gifting')
          ? 'Jumbo'
          : preferredSize
            ? preferredSize.charAt(0).toUpperCase() + preferredSize.slice(1)
            : 'Large';

      return {
        agent: 'sales',
        summary: 'Recommended a size using buyer context and memory.',
        replyHint:
          recommendedSize === 'Jumbo'
            ? 'For gifting, Jumbo is usually preferred for size and presentation. If you want, I can arrange that for you.'
            : `Large is usually the best balance of size, taste, and value. If you want, I can arrange that and guide the next step.`,
        confidence: 0.96,
        recommendedAction: 'RECOMMEND_PRODUCT',
      };
    }

    if (intents.includes('pricing')) {
      return {
        agent: 'sales',
        summary: 'Asked for missing quote inputs.',
        replyHint: 'Tell me the size, quantity, and city you want, and I will prepare the current quote for you.',
        confidence: 0.9,
        recommendedAction: 'COLLECT_QUANTITY_AND_CITY',
      };
    }

    if (intents.includes('product_selection') || intents.includes('order_start') || intents.includes('greeting')) {
      return {
        agent: 'sales',
        summary: 'Guided the customer toward a concrete next step.',
        replyHint: personalization?.reorderHint
          ? `${personalization.reorderHint} Let me know if you want the same quantity or any change.`
          : 'Large is usually the best balance for most buyers. Tell me the quantity and city you want, and I will guide you from there.',
        confidence: 0.88,
        recommendedAction: context.nextAction,
      };
    }

    return {
      agent: 'sales',
      summary: 'Provided a general sales follow-up.',
      replyHint: 'Tell me what you need, and I will guide you clearly. If you want, I can help with pricing, a recommendation, or a fresh order.',
      confidence: 0.72,
      recommendedAction: context.nextAction,
    };
  }
}
