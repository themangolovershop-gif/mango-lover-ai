import type { AgentContext, AgentResult } from './types';

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSimilar(candidate: string, previous: string) {
  const normalizedCandidate = normalize(candidate);
  const normalizedPrevious = normalize(previous);

  if (!normalizedCandidate || !normalizedPrevious) {
    return false;
  }

  return (
    normalizedCandidate === normalizedPrevious ||
    normalizedCandidate.includes(normalizedPrevious) ||
    normalizedPrevious.includes(normalizedCandidate)
  );
}

function dedupeSentences(text: string) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const unique: string[] = [];

  for (const sentence of sentences) {
    if (!unique.some((existing) => isSimilar(sentence, existing))) {
      unique.push(sentence);
    }
  }

  return unique.slice(0, 3).join(' ');
}

function buildFallback(context: AgentContext) {
  if (context.intents.includes('restart_order_request') || context.intents.includes('cancellation')) {
    return 'Understood. We can start fresh. Tell me the size and quantity you want, and I will guide you.';
  }

  if (
    context.intents.includes('complaint') ||
    context.intents.includes('human_help_request') ||
    context.intents.includes('refund')
  ) {
    return 'I am moving this to a human team member so it is handled properly. Please give us a moment.';
  }

  if (context.latestOrder) {
    return 'I may be narrowing this too much. Would you like to continue the current order, change it, or start fresh?';
  }

  return 'Tell me what you need, and I will guide you clearly. If you want, I can help with pricing, a recommendation, or a fresh order.';
}

export class ResponseComposer {
  compose(context: AgentContext, results: AgentResult[]): string {
    if (results.length === 0) {
      return buildFallback(context);
    }

    const priorityMap: Record<AgentResult['agent'], number> = {
      recovery: 1,
      order_ops: 2,
      mango_expert: 3,
      sales: 4,
      orchestrator: 5,
    };

    const ordered = [...results]
      .filter((result) => result.replyHint)
      .sort((left, right) => {
        const priorityDelta = priorityMap[left.agent] - priorityMap[right.agent];

        if (priorityDelta !== 0) {
          return priorityDelta;
        }

        return right.confidence - left.confidence;
      });
    const candidates = ordered
      .map((result) => result.replyHint as string)
      .filter((reply, index, replies) => replies.findIndex((item) => isSimilar(item, reply)) === index);

    for (const candidate of candidates) {
      if (!context.recentAssistantReplies.some((previous) => isSimilar(candidate, previous))) {
        return dedupeSentences(candidate);
      }
    }

    for (let index = 0; index < candidates.length - 1; index += 1) {
      const combined = dedupeSentences(`${candidates[index]} ${candidates[index + 1]}`);

      if (!context.recentAssistantReplies.some((previous) => isSimilar(combined, previous))) {
        return combined;
      }
    }

    return buildFallback(context);
  }
}
