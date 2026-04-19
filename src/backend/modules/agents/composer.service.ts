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
    return 'Acha question hai. Premium Alphonso ka real difference consistency aur natural ripening me feel hota hai.';
  }

  if (
    context.intents.includes('quality_check') ||
    context.intents.includes('authenticity_check') ||
    context.intents.includes('delivery_check') ||
    context.intents.includes('availability_check')
  ) {
    return 'Sach bataun, real Devgad Alphonso ka difference aroma, texture aur overall feel me jaldi samajh aata hai.';
  }

  if (context.intents.includes('recommendation_request') || context.intents.includes('gifting')) {
    return 'Har buyer ka use-case alag hota hai, isliye size suggest karne se pehle thoda context samajhna best rehta hai.';
  }

  if (
    context.intents.includes('greeting') ||
    context.intents.includes('product_selection') ||
    context.intents.includes('order_start')
  ) {
    return 'Bilkul. Pehle requirement samajh lete hain, phir sahi box choose karna easy ho jata hai.';
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
    candidate.agents.includes('order_ops') ||
    hasStoryTone(compact)
  ) {
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
    return 'Theek hai, fresh shuru karte hain. Aap size aur quantity bata do, main aage simple rakhunga.';
  }

  if (
    context.intents.includes('complaint') ||
    context.intents.includes('human_help_request') ||
    context.intents.includes('refund')
  ) {
    return 'Samajh gaya. Isko main human team tak pahucha raha hoon so it gets handled properly. Thoda sa time dijiye.';
  }

  if (context.latestOrder) {
    return 'Sach bataun, is point par best ye hai ki aap seedha bata do: current order continue karna hai, change karna hai, ya fresh start chahiye?';
  }

  return 'Bilkul. Aap price samajhna chahte ho, recommendation chahiye, ya bas real Alphonso ka difference explore karna chahte ho? Main simple tareeke se guide kar dunga.';
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
