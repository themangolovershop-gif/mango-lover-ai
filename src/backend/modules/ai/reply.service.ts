import type { AIReplyContext } from './provider';
import { aiProvider } from './openrouter.provider';
import { appendDeveloperMessage, buildSalesMessages } from './prompt-builder';
import { DETERMINISTIC_TEMPLATES } from './templates';

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

  // 1. Exact match
  if (normalizedCandidate === normalizedPrevious) {
    return true;
  }

  // 2. Inclusion check only for very similar length messages
  if (
    normalizedCandidate.length >= 20 &&
    normalizedPrevious.length >= 20 &&
    Math.abs(normalizedCandidate.length - normalizedPrevious.length) < 10
  ) {
    if (normalizedCandidate.includes(normalizedPrevious) || normalizedPrevious.includes(normalizedCandidate)) {
      return true;
    }
  }

  // 2. Fuzzy word overlap (e.g., if 80% of words are the same)
  const wordsCandidate = new Set(normalizedCandidate.split(' '));
  const wordsPrevious = new Set(normalizedPrevious.split(' '));
  
  if (wordsCandidate.size === 0 || wordsPrevious.size === 0) return false;

  let intersectionCount = 0;
  for (const word of wordsCandidate) {
    if (wordsPrevious.has(word)) {
      intersectionCount++;
    }
  }

  const overlap = intersectionCount / Math.max(wordsCandidate.size, wordsPrevious.size);
  return overlap > 0.85; // 85% word overlap is considered too similar
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
    return "Understood. Let's begin fresh. Tell me the size and quantity you need, and I'll guide you.";
  }

  if (context.intents.includes('order_summary_request') && context.orderSummary) {
    return `You currently have ${context.orderSummary}. I can help you confirm it or make any changes.`;
  }

  if (context.intents.includes('edit_order_request')) {
    return "Just tell me what you'd like to change in the order, and I'll update it for you immediately.";
  }

  const reorderFallback = buildReorderFallback(context);

  if (reorderFallback) {
    return reorderFallback;
  }

  if (context.personalization?.priceSensitive) {
    return 'I can suggest the best option for your budget. Tell me the size or quantity you prefer.';
  }

  return 'Let me confirm: would you like to continue your current order or start fresh?';
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
      'greeting',
      'gratitude',
      'unknown',
    ]);

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

      console.log('[AI] Deterministic reply too similar to previous reply, switching to model path');
    }

    console.log(`[AI] Generating model response for action: ${nextAction}`);
    const messages = buildSalesMessages(context);

    try {
      const gptResponse = await aiProvider.generateCompletion(messages, {
        temperature: 0.4,
        max_tokens: 150,
      });
      let reply = sanitizeReply(gptResponse);

      if (isTooSimilar(reply, lastAssistantReply) || isTooSimilarToRecent(reply, recentAssistantReplies)) {
        console.log('[AI] Generated reply too similar to previous assistant replies, retrying with strict anti-loop instructions');
        const retryMessages = appendDeveloperMessage(
          messages,
          [
            'CRITICAL: Your previous draft reply was too similar to what was already said.',
            'DO NOT repeat yourself. DO NOT use the same sentence structure.',
            'Answer the user\'s LATEST question or concern directly. If they are talking casually, reply casually.',
            'Only push the sales process if they are clearly ready.',
            `Previous draft to AVOID: "${reply}"`,
            context.lastAssistantReply ? `Last assistant reply: "${context.lastAssistantReply}"` : undefined,
          ]
            .filter((line): line is string => Boolean(line))
            .join('\n')
        );

        const retryResponse = await aiProvider.generateCompletion(retryMessages, {
          temperature: 0.55,
          max_tokens: 150,
        });
        reply = sanitizeReply(retryResponse);
      }

      if (isTooSimilar(reply, lastAssistantReply) || isTooSimilarToRecent(reply, recentAssistantReplies)) {
        console.log('[AI] Still too similar after retry, using hard loop breaker');
        return buildLoopBreakerReply(context);
      }

      return reply;
    } catch {
      console.error('[AI] AI generation failed, falling back to loop breaker');
      return buildLoopBreakerReply(context);
    }
  }
}

export const aiReplyService = new AIReplyService();
