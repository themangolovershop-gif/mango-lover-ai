import { AIReplyContext } from './provider';
import { aiProvider } from './openrouter.provider';
import { DETERMINISTIC_TEMPLATES } from './templates';
import { buildSalesPrompt } from './prompt-builder';

function normalizeReplyForComparison(text?: string | null) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTooSimilar(candidate: string, previous?: string) {
  const normalizedCandidate = normalizeReplyForComparison(candidate);
  const normalizedPrevious = normalizeReplyForComparison(previous);

  if (!normalizedCandidate || !normalizedPrevious) {
    return false;
  }

  return (
    normalizedCandidate === normalizedPrevious ||
    normalizedCandidate.includes(normalizedPrevious) ||
    normalizedPrevious.includes(normalizedCandidate)
  );
}

function isTooSimilarToRecent(candidate: string, previousReplies?: string[]) {
  if (!previousReplies || previousReplies.length === 0) {
    return false;
  }

  return previousReplies.some((previous) => isTooSimilar(candidate, previous));
}

function sanitizeReply(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildReorderFallback(context: AIReplyContext) {
  const reorderHint = context.personalization?.reorderHint;

  if (!reorderHint) {
    return undefined;
  }

  return `${reorderHint} Let me know if you want the same quantity or any change.`;
}

function buildLoopBreakerReply(context: AIReplyContext) {
  if (
    context.groundedReplyHint &&
    !isTooSimilar(context.groundedReplyHint, context.lastAssistantReply) &&
    !isTooSimilarToRecent(context.groundedReplyHint, context.recentAssistantReplies)
  ) {
    return context.groundedReplyHint;
  }

  if (context.intents.includes('restart_order_request') || context.intents.includes('cancellation')) {
    return 'Understood. We can start fresh. Tell me the size and quantity you want, and I will guide you.';
  }

  if (context.intents.includes('order_summary_request') && context.orderSummary) {
    return `${context.orderSummary} Tell me if you want to confirm it or change anything.`;
  }

  if (context.intents.includes('edit_order_request')) {
    return 'Tell me the exact change you want in the current order, and I will guide the update.';
  }

  const reorderFallback = buildReorderFallback(context);

  if (reorderFallback) {
    return reorderFallback;
  }

  if (context.personalization?.priceSensitive) {
    return 'I can suggest the most suitable option based on your budget and requirement. Tell me the size or quantity you prefer.';
  }

  return 'I may have misunderstood slightly. Would you like to continue the current order or start fresh?';
}

export class AIReplyService {
  /**
   * Generates a premium, context-aware reply for the customer.
   * Priority: 
   * 1. Deterministic template (for critical/legal/exact flows)
   * 2. AI model (for general inquiry/education/conversation)
   */
  async generateReply(context: AIReplyContext): Promise<string> {
    const { nextAction } = context;
    const lastAssistantReply = context.lastAssistantReply;
    const recentAssistantReplies = context.recentAssistantReplies;
    const modelPreferredIntents = new Set([
      'pricing',
      'recommendation_request',
      'quality_check',
      'authenticity_check',
      'delivery_check',
      'availability_check',
      'gifting',
      'order_summary_request',
      'edit_order_request',
      'restart_order_request',
      'cancellation',
    ]);

    // 1. Check for deterministic template first (only for critical/late stages)
    const criticalActions = ['REQUEST_PAYMENT', 'CONFIRM_ORDER', 'ESCALATE_HUMAN', 'HANDLE_COMPLAINT'];
    const template = DETERMINISTIC_TEMPLATES[nextAction];
    const shouldPreferModel = context.intents.some((intent) => modelPreferredIntents.has(intent));
    const groundedReplyHint = sanitizeReply(context.groundedReplyHint ?? '');

    if (
      groundedReplyHint &&
      !isTooSimilar(groundedReplyHint, lastAssistantReply) &&
      !isTooSimilarToRecent(groundedReplyHint, recentAssistantReplies)
    ) {
      return groundedReplyHint;
    }
    
    if (template && criticalActions.includes(nextAction) && !shouldPreferModel) {
      console.log(`[AI] Using deterministic template for action: ${nextAction}`);
      const deterministicReply = sanitizeReply(template(context));

      if (
        !isTooSimilar(deterministicReply, lastAssistantReply) &&
        !isTooSimilarToRecent(deterministicReply, recentAssistantReplies)
      ) {
        return deterministicReply;
      }

      console.log(`[AI] Deterministic reply too similar to previous reply, switching to model path`);
    }

    // 2. Otherwise, fall back to AI generation
    console.log(`[AI] Generating model response for action: ${nextAction}`);
    const prompt = buildSalesPrompt(context);
    
    try {
      const gptResponse = await aiProvider.generateCompletion(prompt, {
        temperature: 0.45,
        max_tokens: 180,
      });
      let reply = sanitizeReply(gptResponse);

      if (isTooSimilar(reply, lastAssistantReply) || isTooSimilarToRecent(reply, recentAssistantReplies)) {
        console.log('[AI] Generated reply too similar to previous assistant reply, retrying');
        const retryPrompt = `${prompt}\n\nANTI-LOOP RETRY:\nYour previous assistant reply was: ${lastAssistantReply}\nReply differently. Answer the latest customer request first.`;
        const retryResponse = await aiProvider.generateCompletion(retryPrompt, {
          temperature: 0.35,
          max_tokens: 180,
        });
        reply = sanitizeReply(retryResponse);
      }

      if (isTooSimilar(reply, lastAssistantReply) || isTooSimilarToRecent(reply, recentAssistantReplies)) {
        return buildLoopBreakerReply(context);
      }

      return reply;
    } catch (_error) {
      console.error('[AI] AI generation failed, falling back to safe message');
      // Final safety fallback if AI fails
      return buildLoopBreakerReply(context);
    }
  }
}

export const aiReplyService = new AIReplyService();
