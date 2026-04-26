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
    const quoteResult = getToolResult(context, ['get_quote', 'get_product_by_size', 'get_delivery_charge', 'get_catalog_overview']);
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

    if (businessResult?.replyHint) {
      return {
        agent: 'sales',
        summary: 'Used grounded business knowledge for a direct factual reply.',
        replyHint: businessResult.replyHint,
        confidence: 0.94,
        recommendedAction: context.nextAction,
      };
    }

    if (intents.includes('objection_price')) {
      return {
        agent: 'sales',
        summary: 'Handled price objection with value-focused positioning.',
        replyHint: personalization?.priceSensitive
          ? 'I understand budget is a factor. I can suggest a more sensible box size that still gives you the authentic Devgad experience. Would you like to see the options?'
          : 'The real difference with our Devgad Alphonso is the natural ripening process - no carbides, just pure aroma and sweetness. It is a premium experience compared to mass-market fruit. I can suggest the best fit for you.',
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
            ? 'For gifting, Jumbo is the distinct choice. The size and presentation make a lasting impression. Shall I check the availability for you?'
            : 'Honestly, Large is the sweet spot. You get the perfect balance of size, taste, and value. Would you like me to guide you through the next step?',
        confidence: 0.96,
        recommendedAction: 'RECOMMEND_PRODUCT',
      };
    }

    if (intents.includes('pricing')) {
      return {
        agent: 'sales',
        summary: 'Asked for missing quote inputs.',
        replyHint: "Pricing depends on the size, quantity, and your delivery city. Just share these three details, and I'll give you a clear quote immediately.",
        confidence: 0.9,
        recommendedAction: 'COLLECT_QUANTITY_AND_CITY',
      };
    }

    if (intents.includes('greeting')) {
      return {
        agent: 'sales',
        summary: 'Kept the conversation exploratory instead of jumping into checkout.',
        replyHint: "Welcome. Are you looking to explore for home use, or is this for a special gift? I'd be happy to guide you to the right selection.",
        confidence: 0.84,
        recommendedAction: context.nextAction,
      };
    }

    if (intents.includes('product_selection') || intents.includes('order_start')) {
      return {
        agent: 'sales',
        summary: 'Guided the customer toward a concrete next step.',
        replyHint: personalization?.reorderHint
          ? `${personalization.reorderHint} Shall we stick with your usual quantity, or would you like to adjust it?`
          : "Most of our buyers start with Large for its balanced value and taste. Let me know the quantity and city, and I'll take care of the rest.",
        confidence: 0.88,
        recommendedAction: context.nextAction,
      };
    }

    return {
      agent: 'sales',
      summary: 'Provided a general sales follow-up.',
      replyHint: "I'm here to help. Feel free to ask about price, quality, or anything else - I'll keep it direct and simple for you.",
      confidence: 0.72,
      recommendedAction: context.nextAction,
    };


  }
}
