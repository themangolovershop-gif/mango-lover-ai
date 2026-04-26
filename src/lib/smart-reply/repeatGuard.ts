function normalizeReply(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toWordSet(text: string): Set<string> {
  return new Set(normalizeReply(text).split(" ").filter(Boolean));
}

function getTokenOverlapScore(left: string, right: string): number {
  const leftWords = toWordSet(left);
  const rightWords = toWordSet(right);

  if (leftWords.size === 0 || rightWords.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftWords.size, rightWords.size);
}

export function isRepeating(newReply: string, recentAssistantReplies: string[]): boolean {
  const normalizedNewReply = normalizeReply(newReply);

  if (!normalizedNewReply || recentAssistantReplies.length === 0) {
    return false;
  }

  return recentAssistantReplies.some((previousReply) => {
    const normalizedPreviousReply = normalizeReply(previousReply);

    if (!normalizedPreviousReply) {
      return false;
    }

    if (normalizedNewReply === normalizedPreviousReply) {
      console.log(`[SmartReply] RepeatGuard hit: exact match.`);
      return true;
    }

    if (
      normalizedNewReply.length >= 40 &&
      normalizedPreviousReply.length >= 40 &&
      (normalizedNewReply.includes(normalizedPreviousReply) ||
        normalizedPreviousReply.includes(normalizedNewReply))
    ) {
      console.log(`[SmartReply] RepeatGuard hit: substring match.`);
      return true;
    }

    const overlap = getTokenOverlapScore(normalizedNewReply, normalizedPreviousReply);
    if (overlap >= 0.85) {
      console.log(`[SmartReply] RepeatGuard hit: token overlap ${overlap.toFixed(2)} >= 0.85.`);
      return true;
    }

    return false;
  });
}
