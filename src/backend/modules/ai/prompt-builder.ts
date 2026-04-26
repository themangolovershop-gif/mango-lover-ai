import type { AIChatMessage, AIReplyContext } from './provider';
import { BRAND_CONTEXT } from '../../shared/constants/brand';

const SYSTEM_PROMPT = `
You are a smart, adaptive AI sales concierge for a premium mango brand.

You are NOT a flow bot.
You are NOT a script.

You behave like:
- a highly intelligent conversational assistant
- a human sales expert
- a premium concierge

Core rules:

1. Always interpret the latest user message first.
2. Current sales stage is context, not prison.
3. Never repeat the same sentence or action.
4. If the user asks something new, answer that first.
5. If the user wants to restart, edit, summarize, or change the order, handle that immediately.
6. After order creation, support flexible order assistance naturally.
7. Keep replies short, clear, premium, and human-like.
8. Do not hallucinate live order, payment, or pricing data.
9. Use provided order/memory/context truthfully.
10. If unsure, ask a short clarification instead of guessing.

Behavior priorities:
1. Understand latest user intent
2. Check if there is an interrupt intent
3. Use current order and memory context if relevant
4. Answer the user's actual question
5. Then guide toward the next best step if relevant

Supported modes:
- sales mode
- support mode
- order mode
- recovery mode

Mango knowledge:
- Devgad Alphonso is premium, aromatic, smooth, and sweet
- natural ripening means no carbide and better taste
- Medium = budget-friendly
- Large = best balance
- Jumbo = gifting
- raw mangoes should ripen at room temperature
- refrigerate only after ripe

Never sound robotic.
Never force the same sales step repeatedly.
Never ignore the latest user message.
`.trim();



function titleCase(value: string) {
  return value
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(' ');
}

function formatBoolean(value?: boolean) {
  if (value === undefined) return undefined;
  return value ? 'true' : 'false';
}

function buildCustomerMemoryBlock(context: AIReplyContext) {
  const profile = context.customerMemoryProfile;
  
  const lines = [
    context.customerName ? `Name: ${context.customerName}` : undefined,
    profile?.preferredSize ? `Preferred size: ${titleCase(profile.preferredSize)}` : undefined,
    profile ? `Repeat buyer: ${profile.repeatCustomer ? 'true' : 'false'}` : undefined,
    formatBoolean(profile?.priceSensitive) ? `Price sensitive: ${formatBoolean(profile?.priceSensitive)}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return lines.length > 0 ? lines.join('\n') : 'No previous memory context available.';
}

function buildLeadStateBlock(context: AIReplyContext) {
  const lines = [
    `Stage: ${context.leadStage || 'new'}`,
    `Buyer type: ${context.buyerType || 'individual'}`,
    context.leadScore !== undefined ? `Lead score: ${context.leadScore}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return lines.join('\n');
}

function buildOrderStateBlock(context: AIReplyContext) {
  const order = context.orderContext;

  if (!order || !order.draftOrderExists) {
    return 'Draft order exists: no';
  }

  const lines = [
    `Draft order exists: yes`,
    order.product ? `Product: ${order.product}` : undefined,
    order.quantityDozen !== undefined ? `Quantity: ${order.quantityDozen} dozen` : undefined,
    order.deliveryCity ? `Delivery city: ${titleCase(order.deliveryCity)}` : undefined,
    order.paymentStatus ? `Payment status: ${order.paymentStatus.toLowerCase()}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return lines.join('\n');
}

function buildAssistantRepliesBlock(context: AIReplyContext) {
  const replies = [...(context.recentAssistantReplies ?? [])];
  if (context.lastAssistantReply && !replies.includes(context.lastAssistantReply)) {
    replies.push(context.lastAssistantReply);
  }
  const uniqueReplies = Array.from(new Set(replies.map(r => r.trim()).filter(Boolean))).slice(-2);

  return uniqueReplies.length > 0
    ? uniqueReplies.map((r, i) => `${i + 1}. ${r}`).join('\n')
    : 'None';
}

function buildNextBestActionHint(context: AIReplyContext) {
  if (context.intents.includes('order_summary_request')) {
    return 'If user asks order question, answer with order summary first.';
  }
  
  if (context.nextAction === 'REQUEST_PAYMENT') {
    return 'User has a pending order; summarize it and guide toward payment if no new questions are asked.';
  }

  return 'Answer the user\'s latest question directly, then guide the next step only if it helps the transition.';
}

function buildDeveloperContextMessage(context: AIReplyContext) {
  return `
Current business context:

Brand: The Mango Lover Shop
Website: themangolovershop.in
Core facts:
- authentic GI-tagged Devgad Alphonso
- naturally ripened
- carbide-free
- premium quality
- 52-year family legacy

Conversation control rules:
- latest user intent overrides stale flow when appropriate
- answer first, then guide
- do not repeat prior assistant reply
- if user asks for reset/edit/summary, handle it immediately
- use order and payment data exactly as provided
- do not invent unavailable data

Customer memory:
${buildCustomerMemoryBlock(context)}

Current lead state:
${buildLeadStateBlock(context)}

Current order state:
${buildOrderStateBlock(context)}

Last assistant replies:
${buildAssistantRepliesBlock(context)}

Anti-repeat note:
If your draft reply is substantially similar to the recent assistant replies, rewrite it with a different approach.

Current next-best-action hint:
${buildNextBestActionHint(context)}
  `.trim();
}

export function buildSalesMessages(context: AIReplyContext): AIChatMessage[] {
  return [
    {
      role: 'system',
      content: SYSTEM_PROMPT,
    },
    {
      role: 'developer',
      content: buildDeveloperContextMessage(context),
    },
    {
      role: 'user',
      content: context.latestUserMessage?.trim() || 'what did I order?',
    },
  ];
}

export function appendDeveloperMessage(messages: AIChatMessage[], content: string): AIChatMessage[] {
  const developerMessage: AIChatMessage = {
    role: 'developer',
    content: content.trim(),
  };

  if (messages.length === 0) return [developerMessage];
  
  const lastUserIndex = [...messages].reverse().findIndex(m => m.role === 'user');
  if (lastUserIndex !== -1) {
    const splitIndex = messages.length - 1 - lastUserIndex;
    return [...messages.slice(0, splitIndex), developerMessage, ...messages.slice(splitIndex)];
  }

  return [...messages, developerMessage];
}

