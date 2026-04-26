import { getAIConfig, getOpenAIClient } from "@/lib/ai";
import type { ChatMessage } from "./conversationHistory";
import {
  buildSmartReplyMessages,
  SAFE_FALLBACK_REPLY,
  SMART_REPLY_SOFT_LIMITS,
  type SmartReplyMessage,
} from "./promptBuilder";
import { isRepeating } from "./repeatGuard";

type GenerateSmartReplyArgs = {
  history: ChatMessage[];
  latestUserMessage: string;
  recentAssistantReplies: string[];
  extraSystemInstruction?: string;
};

function normalizeReply(reply: string | null | undefined): string {
  return (reply || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function trimReplyToSentenceLimit(reply: string, maxSentences: number): string {
  const sentences = reply.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()) || [];

  if (sentences.length === 0) {
    return reply.trim();
  }

  return sentences.slice(0, maxSentences).join(" ").trim();
}

function formatReply(reply: string | null | undefined): string {
  const normalizedReply = normalizeReply(reply);

  if (!normalizedReply) {
    return "";
  }

  const shortenedReply = trimReplyToSentenceLimit(
    normalizedReply,
    SMART_REPLY_SOFT_LIMITS.maxSentences
  );
  if (shortenedReply.length <= SMART_REPLY_SOFT_LIMITS.maxCharacters) {
    return shortenedReply;
  }

  const truncatedReply = shortenedReply
    .slice(0, SMART_REPLY_SOFT_LIMITS.maxCharacters - 3)
    .replace(/\s+\S*$/, "")
    .trim();

  return `${truncatedReply || shortenedReply.slice(0, SMART_REPLY_SOFT_LIMITS.maxCharacters - 3).trim()}...`;
}

async function requestSmartReply(messages: SmartReplyMessage[]): Promise<string | null> {
  try {
    const openai = getOpenAIClient();
    const { model } = getAIConfig();
    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0.6,
      max_tokens: 220,
    });

    return normalizeReply(completion.choices[0]?.message?.content);
  } catch (error) {
    console.error("[SmartReply] AI generation failed", error);
    return null;
  }
}

export async function generateSmartReply(
  args: GenerateSmartReplyArgs
): Promise<string> {
  const baseMessages = buildSmartReplyMessages({
    history: args.history,
    latestUserMessage: args.latestUserMessage,
    extraSystemInstruction: args.extraSystemInstruction,
  });
  const firstDraft = formatReply(await requestSmartReply(baseMessages));

  if (!firstDraft) {
    console.warn(`[SmartReply] First draft generation failed, using fallback.`);
    return SAFE_FALLBACK_REPLY;
  }

  if (!isRepeating(firstDraft, args.recentAssistantReplies)) {
    return firstDraft;
  }

  console.log(`[SmartReply] First draft was repeating. Generating retry draft...`);
  const retryDraft = formatReply(
    await requestSmartReply(
      buildSmartReplyMessages({
        history: args.history,
        latestUserMessage: args.latestUserMessage,
        extraSystemInstruction:
          "Do not repeat. Answer the latest customer message in a fresh, natural way.",
      })
    )
  );

  if (!retryDraft) {
    console.warn(`[SmartReply] Retry draft generation failed, using fallback.`);
    return SAFE_FALLBACK_REPLY;
  }

  if (isRepeating(retryDraft, args.recentAssistantReplies)) {
    console.warn(`[SmartReply] Retry draft was ALSO repeating. Using fallback.`);
    return SAFE_FALLBACK_REPLY;
  }

  return retryDraft;
}
