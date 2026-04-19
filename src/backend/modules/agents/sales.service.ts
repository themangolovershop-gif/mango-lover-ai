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
          ? 'Acha question hai. Agar budget mind me hai, toh main aapko sabse sensible size suggest kar sakta hoon. Aap size ya quantity share karo, main seedha guide kar deta hoon.'
          : businessResult?.replyHint ??
            'Sach bataun, premium Devgad Alphonso ka difference tab feel hota hai jab aroma, texture aur sweetness teenon consistent milte hain. Hum naturally ripened fruit rakhte hain, isliye taste mass-market fruit jaisa mixed nahi lagta. Agar chaho toh main aapke use ke hisab se best option suggest kar doon.',
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
            ? 'Sach bataun, gifting me Jumbo isliye pasand aata hai kyunki box khulte hi size aur presentation dono feel hote hain. Agar chaho toh main uske liye best quantity bhi suggest kar doon.'
            : 'Honestly, Large most buyers ke liye safest sweet spot hota hai. Size, taste aur value teenon balanced rehte hain. Agar chaho toh main next step simple rakh deta hoon.',
        confidence: 0.96,
        recommendedAction: 'RECOMMEND_PRODUCT',
      };
    }

    if (intents.includes('pricing')) {
      return {
        agent: 'sales',
        summary: 'Asked for missing quote inputs.',
        replyHint: 'Acha question hai. Devgad Alphonso ka exact quote size, quantity aur city pe depend karta hai. Aap ye teen details bhejo, main proper quote clear tareeke se bata deta hoon.',
        confidence: 0.9,
        recommendedAction: 'COLLECT_QUANTITY_AND_CITY',
      };
    }

    if (intents.includes('greeting')) {
      return {
        agent: 'sales',
        summary: 'Kept the conversation exploratory instead of jumping into checkout.',
        replyHint: 'Bilkul. Aap casual explore kar rahe ho, gifting dekh rahe ho, ya ghar ke liye best box samajhna chahte ho? Main simple tareeke se guide kar dunga.',
        confidence: 0.84,
        recommendedAction: context.nextAction,
      };
    }

    if (intents.includes('product_selection') || intents.includes('order_start')) {
      return {
        agent: 'sales',
        summary: 'Guided the customer toward a concrete next step.',
        replyHint: personalization?.reorderHint
          ? `${personalization.reorderHint} Aap bolo same quantity rakhni hai ya kuch change karna hai.`
          : 'Bilkul. Most buyers Large se start karte hain kyunki taste aur value balanced rehte hain. Aap quantity aur city batao, main next step simple rakhunga.',
        confidence: 0.88,
        recommendedAction: context.nextAction,
      };
    }

    return {
      agent: 'sales',
      summary: 'Provided a general sales follow-up.',
      replyHint: 'Bilkul. Aap jo bhi doubt hai seedha poochho - price, quality, gifting, ya fresh order. Main honestly aur simple tareeke se guide kar dunga.',
      confidence: 0.72,
      recommendedAction: context.nextAction,
    };
  }
}
