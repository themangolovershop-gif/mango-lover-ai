import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import type { ChatMessage } from "./conversationHistory";

export const SMART_REPLY_SOFT_LIMITS = {
  maxSentences: 5,
  maxCharacters: 550,
} as const;

export const SMART_REPLY_SYSTEM_PROMPT = `${SYSTEM_PROMPT.trim()}

----------------------------------------
## LIVE WHATSAPP GUARDRAILS

- Always respond to the latest user message first.
- Do not follow a rigid scripted flow.
- Do not repeat the same reply or sentence structure.
- Answer the question clearly before guiding the next step.
- Keep the tone premium, warm, human, and Hinglish-friendly when the user speaks that way.
- Use short WhatsApp-friendly paragraphs.
- You may use a brief story, insight, or comparison when it helps build trust.
- Usually keep replies to 2-5 sentences and under ${SMART_REPLY_SOFT_LIMITS.maxCharacters} characters.
- Do not push payment or checkout unless the customer shows clear buying intent.
- If the customer is ready to buy, guide them clearly on size, quantity, address, and delivery date.
- If unsure, ask one short clarification instead of guessing.
- Never sound like a scripted bot or generic customer support.

----------------------------------------`;

export const SAFE_FALLBACK_REPLY =
  "I'm here to help. Please tell me if you're looking for mango availability, pricing, delivery, or order support.";

export type SmartReplyMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type BuildSmartReplyMessagesArgs = {
  history: ChatMessage[];
  latestUserMessage: string;
  extraSystemInstruction?: string;
};

export function buildSmartReplyMessages(
  args: BuildSmartReplyMessagesArgs
): SmartReplyMessage[] {
  const history = args.history.slice(-12).map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const latestUserMessage = args.latestUserMessage.trim();
  const messages: SmartReplyMessage[] = [
    {
      role: "system",
      content: SMART_REPLY_SYSTEM_PROMPT,
    },
    ...history,
  ];

  if (args.extraSystemInstruction?.trim()) {
    messages.push({
      role: "system",
      content: args.extraSystemInstruction.trim(),
    });
  }

  messages.push({
    role: "user",
    content: latestUserMessage,
  });

  return messages;
}
