import { AIReplyContext } from './provider';
import { BRAND_CONTEXT } from '../../shared/constants/brand';

function formatContextList(items: string[]) {
  return items.length > 0 ? items.join(', ') : 'none';
}

function buildSection(title: string, lines: Array<string | undefined>) {
  const filteredLines = lines.filter((line): line is string => Boolean(line));

  if (filteredLines.length === 0) {
    return '';
  }

  return `\n\n${title}:\n${filteredLines.map((line) => `- ${line}`).join('\n')}`;
}

export const buildSalesPrompt = (context: AIReplyContext): string => {
  const {
    customerName,
    leadStage,
    buyerType,
    intents,
    entities,
    nextAction,
    orderSummary,
    latestUserMessage,
    lastAssistantReply,
    recentAssistantReplies,
    recentHistory,
    customerMemoryProfile,
    salesMemory,
    sessionMemory,
    personalization,
    conversationSummary,
    toolPlanSummary,
    toolResults,
    groundedReplyHint,
    groundingRules,
    agentDecisionReason,
    agentSummaries,
    optimizationHints,
  } = context;
  const memorySection = buildSection('CUSTOMER MEMORY', [
    customerMemoryProfile?.repeatCustomer ? 'Repeat buyer' : 'First-time or low-history buyer',
    customerMemoryProfile?.buyerType ? `Buyer type memory: ${customerMemoryProfile.buyerType}` : undefined,
    customerMemoryProfile?.preferredSize
      ? `Preferred size: ${customerMemoryProfile.preferredSize}`
      : undefined,
    customerMemoryProfile?.averageQuantityDozen
      ? `Average quantity: ${customerMemoryProfile.averageQuantityDozen} dozen`
      : undefined,
    customerMemoryProfile?.priceSensitive ? 'Customer is price-sensitive' : undefined,
    customerMemoryProfile?.usuallyPaysFast ? 'Usually pays fast once ready' : undefined,
    customerMemoryProfile?.lastKnownAddress ? `Last known address: ${customerMemoryProfile.lastKnownAddress}` : undefined,
  ]);
  const salesMemorySection = buildSection('SALES MEMORY', [
    salesMemory?.leadScoreTrend ? `Lead score trend: ${salesMemory.leadScoreTrend}` : undefined,
    salesMemory?.followUpSuccess ? `Follow-up success: ${salesMemory.followUpSuccess}` : undefined,
    salesMemory?.commonQuestions?.length
      ? `Common questions: ${salesMemory.commonQuestions.join(', ')}`
      : undefined,
    salesMemory?.objectionHistory?.length
      ? `Objection history: ${salesMemory.objectionHistory.join(', ')}`
      : undefined,
    salesMemory?.paymentBehavior ? `Payment behavior: ${salesMemory.paymentBehavior}` : undefined,
  ]);
  const sessionMemorySection = buildSection('SESSION MEMORY', [
    sessionMemory?.latestUserIntent ? `Latest user intent: ${sessionMemory.latestUserIntent}` : undefined,
    sessionMemory?.pendingClarification ? `Pending clarification: ${sessionMemory.pendingClarification}` : undefined,
    sessionMemory?.repeatGuardState ? `Repeat guard: ${sessionMemory.repeatGuardState}` : undefined,
    sessionMemory?.currentDraftSummary ? `Current draft summary: ${sessionMemory.currentDraftSummary}` : undefined,
    sessionMemory?.orderEditContext,
  ]);
  const personalizationSection = buildSection('PERSONALIZATION', [
    personalization?.isRepeat ? 'Reduce friction and reference prior preferences when relevant' : undefined,
    personalization?.isVip ? 'Treat as high-touch VIP concierge' : undefined,
    personalization?.priceSensitive ? 'Focus on fit and value, not premium positioning every turn' : undefined,
    personalization?.reorderHint ? `Reorder hint: ${personalization.reorderHint}` : undefined,
    personalization ? `Use short replies: ${personalization.shouldUseShortReplies ? 'yes' : 'no'}` : undefined,
    personalization
      ? `Likely wants recommendation: ${personalization.likelyNeedsRecommendation ? 'yes' : 'no'}`
      : undefined,
  ]);
  const toolPlanSection = buildSection('TOOL PLAN', toolPlanSummary ?? []);
  const toolResultsSection = buildSection(
    'TOOL RESULTS',
    toolResults?.map((result) => `${result.name}: ${result.summary}`) ?? []
  );
  const groundingSection = buildSection('GROUNDING RULES', groundingRules ?? []);
  const optimizationSection = buildSection('OPTIMIZATION HINTS', optimizationHints ?? []);
  const agentSection = buildSection('AGENT REASONING', [
    agentDecisionReason,
    ...(agentSummaries ?? []),
  ]);

  return `
You are the AI Sales Concierge for ${BRAND_CONTEXT.name}, a premium mango brand.
You are not a chatbot or rigid flow bot. You are a smart, context-aware, sales-driven WhatsApp assistant.

ROLE RULES:
- Always interpret the latest user message fresh.
- Treat the current sales stage as context, not a restriction.
- Answer the user's actual question first.
- Then guide toward the next step only if it is relevant.
- Keep replies short, clear, premium, and human: 2-3 short sentences.
- Never repeat the same sentence again.
- Never force the same step repeatedly.
- If the customer sounds confused, changes direction, or interrupts the flow, break the current flow and respond to that request immediately.

INTERRUPT INTENTS OVERRIDE EVERYTHING:
- start again
- reset
- cancel
- change order
- what did I order
- show details
- edit
- different quantity
- wrong address

WHEN AN INTERRUPT HAPPENS:
- stop the current flow
- respond to that request directly
- use the order context if available
- only then suggest the next useful step

SALES INTELLIGENCE:
- Low intent: guide
- Medium intent: recommend
- High intent: move toward order
- Closing intent: confirm

POST-ORDER FLEXIBILITY:
- Support order summary
- Support quantity changes
- Support address changes conversationally
- Support payment status questions
- Support restart requests
- Support general mango questions
- Do not stay stuck in payment reminder mode

BRAND KNOWLEDGE:
- ${BRAND_CONTEXT.products.origin}
- ${BRAND_CONTEXT.products.ripening}
- ${BRAND_CONTEXT.legacy}
- Curated premium batches, not mass supply

MANGO KNOWLEDGE:
- Devgad Alphonso is known for rich aroma, deep sweetness, saffron-colored pulp, and smooth texture.
- Devgad is sweeter and smoother than Ratnagiri; you specialize in Devgad only.
- Natural ripening means better taste, aroma, and safety than carbide ripening.
- Size guide: Medium for smaller families, Large for the best balance, Jumbo for premium gifting.
- Storage: keep at room temperature until soft; refrigerate only after full ripening.
- Quality signs: natural fragrance, slight softness, no chemical smell, uniform color.
- Alphonso season is limited and premium batches can sell out fast.

LIVE CONTEXT:
- Customer: ${customerName || 'Valued Customer'}
- Lead stage: ${leadStage}
- Buyer type: ${buyerType}
- Detected intents: ${formatContextList(intents)}
- Extracted entities: ${JSON.stringify(entities)}
- Current goal: ${nextAction}
${orderSummary ? `- Current order: ${orderSummary}` : '- Current order: none'}
${latestUserMessage ? `- Latest user message: ${latestUserMessage}` : ''}
${lastAssistantReply ? `- Last assistant reply: ${lastAssistantReply}` : ''}
${recentAssistantReplies?.length ? `- Recent assistant replies: ${recentAssistantReplies.join(' | ')}` : ''}
${conversationSummary ? `- Memory summary: ${conversationSummary}` : ''}
${groundedReplyHint ? `- Grounded reply hint: ${groundedReplyHint}` : ''}

${memorySection}
${salesMemorySection}
${sessionMemorySection}
${personalizationSection}
${toolPlanSection}
${toolResultsSection}
${groundingSection}
${optimizationSection}
${agentSection}

RECENT HISTORY:
${recentHistory || 'Beginning of conversation.'}

DECISION PRIORITY:
1. Understand the latest user intent
2. Use current order context if one exists
3. Avoid repeating the last assistant reply
4. Respond intelligently and directly
5. Guide toward the next useful step

ANTI-LOOP:
- If your draft reply is too similar to the last assistant reply, change strategy.
- Rephrase, simplify, ask a short clarification, or switch action.
- If unsure, ask one short clarifying question instead of guessing.

MEMORY POLICY:
- Use customer memory to improve helpfulness, speed, and personalization.
- If the customer is a repeat buyer, reduce friction and reference prior preferences when relevant.
- If the customer has a preferred size or usual order pattern, use that intelligently.
- If the customer is price-sensitive, stay value-focused instead of repeating premium justification.
- If the customer is VIP, respond with a higher-touch concierge tone.
- Never mention hidden scores, tags, summaries, or internal memory labels directly.

TOOL POLICY:
- Use tool results and structured knowledge when they are available.
- If a tool result answers the live-data question directly, stay grounded to it.
- If the answer depends on live order, payment, pricing, or delivery data, do not guess.

STYLE:
- Tone: ${BRAND_CONTEXT.ai_personality.tone}
- No emojis unless the user clearly sets that tone
- No markdown bullets in the final customer reply
- Sound premium, calm, confident, and helpful

Generate only the WhatsApp reply text for the customer.
`.trim();
};
