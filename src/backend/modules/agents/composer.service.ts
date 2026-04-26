import type { AgentContext, AgentResult } from './types';

type CandidateReply = {
  agents: AgentResult['agent'][];
  text: string;
};

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
    ((normalizedCandidate.length < 15 || normalizedPrevious.length < 15) &&
      (normalizedCandidate.includes(normalizedPrevious) || normalizedPrevious.includes(normalizedCandidate)))
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

function hasStoryTone(text: string) {
  const normalized = normalize(text);
  return [
    'acha question hai',
    'sach bataun',
    'honestly',
    'bilkul',
    'real devgad alphonso',
    'naturally ripened',
  ].some((marker) => normalized.includes(marker));
}

function isOperationalContext(context: AgentContext) {
  return context.intents.some((intent) =>
    [
      'restart_order_request',
      'cancellation',
      'reset_conversation',
      'payment_update',
      'order_summary_request',
      'edit_order_request',
      'human_help_request',
      'complaint',
      'refund',
    ].includes(intent)
  );
}

function getStoryLead(context: AgentContext) {
  if (context.intents.includes('pricing') || context.intents.includes('objection_price')) {
    return "That is a great question. The real value of premium Alphonso lies in the consistency of taste and our natural ripening process.";
  }

  if (
    context.intents.includes('quality_check') ||
    context.intents.includes('authenticity_check') ||
    context.intents.includes('delivery_check') ||
    context.intents.includes('availability_check')
  ) {
    return "Honestly, you can tell the difference with real Devgad Alphonso through its distinct aroma and smooth texture.";
  }

  if (context.intents.includes('recommendation_request') || context.intents.includes('gifting')) {
    return "Every requirement is unique, so I'd like to suggest the most suitable box based on your specific needs.";
  }

  if (
    context.intents.includes('greeting') ||
    context.intents.includes('product_selection') ||
    context.intents.includes('order_start')
  ) {
    return "Certainly. Once we understand your preference, selecting the perfect box becomes quite simple.";
  }

  return null;
}

function applyPersonalityPass(
  context: AgentContext,
  candidate: CandidateReply
) {
  const compact = dedupeSentences(candidate.text);

  if (
    isOperationalContext(context) ||
    candidate.agents.includes('recovery') ||
    candidate.agents.includes('order_ops')
  ) {
    return compact;
  }

  if (candidate.agents.includes('mango_expert') && candidate.agents.includes('sales')) {
    return compact;
  }

  const storyLead = getStoryLead(context);

  if (!storyLead) {
    return compact;
  }

  return dedupeSentences(`${storyLead} ${compact}`);
}

function buildFallback(context: AgentContext) {
  if (context.intents.includes('restart_order_request') || context.intents.includes('cancellation')) {
    return "Understood. Let's start fresh. Just tell me the size and quantity you prefer, and I'll guide you from there.";
  }

  if (
    context.intents.includes('complaint') ||
    context.intents.includes('human_help_request') ||
    context.intents.includes('refund')
  ) {
    return "I see. I'm escalating this to our human team immediately to ensure it's handled properly. Please bear with us for a moment.";
  }

  if (context.latestOrder) {
    return "Let me get this right - would you like to proceed with your current order, make a change, or start fresh?";
  }

  return "I'm here to assist. Are you looking for a recommendation, pricing details, or would you like to know more about our authentic Alphonso? I can guide you through any of these.";
}



function maybeBlendAdvisoryAndSales(
  context: AgentContext,
  ordered: AgentResult[]
) {
  if (isOperationalContext(context)) {
    return null;
  }

  const expertReply = ordered.find(
    (result) => result.agent === 'mango_expert' && result.replyHint
  );
  const salesReply = ordered.find(
    (result) => result.agent === 'sales' && result.replyHint
  );

  if (!expertReply || !salesReply) {
    return null;
  }

  return {
    agents: ['mango_expert', 'sales'] as AgentResult['agent'][],
    text: `${expertReply.replyHint as string} ${salesReply.replyHint as string}`,
  };
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
      .map((result) => ({
        agents: [result.agent],
        text: result.replyHint as string,
      }))
      .filter(
        (candidate, index, replies) =>
          replies.findIndex((item) => isSimilar(item.text, candidate.text)) === index
      );

    const blended = maybeBlendAdvisoryAndSales(context, ordered);
    if (blended) {
      const polishedBlend = applyPersonalityPass(context, blended);

      if (
        !context.recentAssistantReplies.some((previous) => isSimilar(polishedBlend, previous))
      ) {
        return polishedBlend;
      }
    }

    for (const candidate of candidates) {
      const polishedCandidate = applyPersonalityPass(context, candidate);

      if (!context.recentAssistantReplies.some((previous) => isSimilar(polishedCandidate, previous))) {
        return polishedCandidate;
      }
    }

    for (let index = 0; index < candidates.length - 1; index += 1) {
      const combined = applyPersonalityPass(context, {
        agents: [...candidates[index].agents, ...candidates[index + 1].agents],
        text: `${candidates[index].text} ${candidates[index + 1].text}`,
      });

      if (!context.recentAssistantReplies.some((previous) => isSimilar(combined, previous))) {
        return combined;
      }
    }

    return buildFallback(context);
  }
}
