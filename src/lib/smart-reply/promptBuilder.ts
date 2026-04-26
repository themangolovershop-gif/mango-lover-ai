import type { ChatMessage } from "./conversationHistory";

export const SMART_REPLY_SYSTEM_PROMPT = `You are the official AI assistant for The Mango Lover Shop.

You behave like a smart human assistant, not a scripted bot.

Your job:
- understand the user's latest message
- reply naturally and helpfully
- maintain a premium, calm, human tone
- answer mango, product, price, delivery, and general questions clearly
- guide the conversation only when relevant

Rules:
1. Always respond to the latest user message first.
2. Do NOT follow a rigid flow.
3. Do NOT repeat the same reply.
4. Do NOT force sales or payment steps.
5. If user says "hi", greet naturally and ask what they are looking for.
6. If user asks a question, answer clearly before guiding.
7. If user wants to order, then assist step-by-step.
8. If unsure, ask a short clarification.
9. Keep replies short: 1-3 sentences.
10. Never sound robotic.

Tone:
- warm
- premium
- clear
- concise
- human-like
- Hinglish-friendly if user uses Hinglish

Brand:
- The Mango Lover Shop
- premium Devgad Alphonso mangoes
- naturally ripened
- carbide-free
- 52-year family legacy
- website: themangolovershop.in

Mango knowledge:
- Devgad Alphonso is known for rich aroma, sweet taste, and smooth texture
- Medium is good for regular use
- Large gives the best balance
- Jumbo is preferred for gifting
- unripe mangoes should ripen at room temperature
- refrigerate only after ripe

Important:
You are a conversational assistant, not a sales script.`;

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
