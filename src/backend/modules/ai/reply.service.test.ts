import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateCompletion } = vi.hoisted(() => ({
  generateCompletion: vi.fn(),
}));

vi.mock('@/backend/modules/ai/openrouter.provider', () => ({
  aiProvider: {
    generateCompletion,
  },
}));

import { AIReplyService } from '@/backend/modules/ai/reply.service';

describe('reply.service', () => {
  beforeEach(() => {
    generateCompletion.mockReset();
  });

  it('uses the model instead of a payment template for order support intents', async () => {
    generateCompletion.mockResolvedValue('Here is your current order summary. Tell me if you want any changes.');
    const service = new AIReplyService();

    const reply = await service.generateReply({
      phone: '+919000000000',
      leadStage: 'AWAITING_PAYMENT',
      buyerType: 'PERSONAL',
      intents: ['order_summary_request'],
      entities: {},
      nextAction: 'REQUEST_PAYMENT',
      orderSummary: 'Current order MLS-1: 2 large boxes. Status PENDING_PAYMENT. Payment UNPAID. Total INR 3798.00.',
      latestUserMessage: 'what did i order',
      lastAssistantReply: 'Please complete the payment and share a screenshot.',
      recentHistory: 'Assistant: Please complete the payment and share a screenshot.\nCustomer: what did i order',
    });

    expect(generateCompletion).toHaveBeenCalledTimes(1);
    const [messages] = generateCompletion.mock.calls[0];
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('developer');
    expect(messages[1].content).toContain('Current business context');
    expect(messages[1].content).toContain('Current order state');
    expect(messages[2]).toEqual({
      role: 'user',
      content: 'what did i order',
    });
    expect(reply).toContain('order summary');
  });

  it('falls back to a loop breaker when model responses keep repeating', async () => {
    generateCompletion
      .mockResolvedValueOnce('Please complete the payment and share a screenshot.')
      .mockResolvedValueOnce('Please complete the payment and share a screenshot.');

    const service = new AIReplyService();
    const reply = await service.generateReply({
      phone: '+919000000000',
      leadStage: 'AWAITING_PAYMENT',
      buyerType: 'PERSONAL',
      intents: ['edit_order_request'],
      entities: {},
      nextAction: 'REQUEST_PAYMENT',
      orderSummary: 'Current order MLS-1: 2 large boxes. Status PENDING_PAYMENT. Payment UNPAID. Total INR 3798.00.',
      latestUserMessage: 'change order',
      lastAssistantReply: 'Please complete the payment and share a screenshot.',
      recentHistory: 'Assistant: Please complete the payment and share a screenshot.\nCustomer: change order',
    });

    expect(generateCompletion).toHaveBeenCalledTimes(2);
    const [retryMessages] = generateCompletion.mock.calls[1];
    expect(retryMessages.some((message: { role: string; content: string }) =>
      message.role === 'developer' &&
      message.content.includes('CRITICAL: Your previous draft reply was too similar to what was already said.')
    )).toBe(true);
    expect(reply).toContain("what you'd like to change");
  });

  it('prefers the model for conversational intents even during awaiting payment', async () => {
    const service = new AIReplyService();

    for (const intent of ['unknown', 'greeting', 'gratitude'] as const) {
      generateCompletion.mockResolvedValueOnce('Of course. Tell me what you need, and I will help from here.');

      const reply = await service.generateReply({
        phone: '+919000000000',
        leadStage: 'AWAITING_PAYMENT',
        buyerType: 'PERSONAL',
        intents: [intent],
        entities: {},
        nextAction: 'REQUEST_PAYMENT',
        orderSummary: 'Current order MLS-1: 2 large boxes. Status PENDING_PAYMENT. Payment UNPAID. Total INR 3798.00.',
        latestUserMessage: intent === 'unknown' ? 'wait what?' : intent === 'greeting' ? 'hello' : 'thanks',
        lastAssistantReply: 'Please complete the payment and share a screenshot.',
        recentHistory: 'Assistant: Please complete the payment and share a screenshot.',
      });

      expect(reply).toContain('Of course');
    }

    expect(generateCompletion).toHaveBeenCalledTimes(3);
  });

  it('retries when the draft is only fuzzily different from the previous reply', async () => {
    generateCompletion
      .mockResolvedValueOnce('Please complete payment and share screenshot here now.')
      .mockResolvedValueOnce('Of course. What would you like to sort out first?');

    const service = new AIReplyService();
    const reply = await service.generateReply({
      phone: '+919000000000',
      leadStage: 'AWAITING_PAYMENT',
      buyerType: 'PERSONAL',
      intents: ['unknown'],
      entities: {},
      nextAction: 'REQUEST_PAYMENT',
      latestUserMessage: 'wait what?',
      lastAssistantReply: 'Please complete the payment and share a screenshot here.',
      recentAssistantReplies: ['Please complete the payment and share a screenshot here.'],
    });

    expect(generateCompletion).toHaveBeenCalledTimes(2);
    expect(reply).toContain('What would you like to sort out first?');
  });

  it('uses the reorder-aware loop breaker for repeat buyers when the model keeps repeating', async () => {
    generateCompletion
      .mockResolvedValueOnce('Please share the quantity and city.')
      .mockResolvedValueOnce('Please share the quantity and city.');

    const service = new AIReplyService();
    const reply = await service.generateReply({
      phone: '+919000000000',
      leadStage: 'ENGAGED',
      buyerType: 'REPEAT',
      intents: ['repeat_order'],
      entities: {},
      nextAction: 'COLLECT_QUANTITY_AND_CITY',
      latestUserMessage: 'same as last time',
      lastAssistantReply: 'Please share the quantity and city.',
      recentHistory: 'Assistant: Please share the quantity and city.\nCustomer: same as last time',
      personalization: {
        isRepeat: true,
        isVip: false,
        vipScore: 45,
        buyerType: 'repeat',
        shouldUseShortReplies: true,
        likelyNeedsRecommendation: true,
        usuallyPaysFast: false,
        reorderHint: 'Welcome back. I can arrange your previous Large selection again for Mumbai delivery with 2 dozen.',
      },
    });

    expect(generateCompletion).toHaveBeenCalledTimes(2);
    expect(reply).toContain('Welcome back.');
    expect(reply).toContain('any change');
  });

  it('returns the grounded reply hint immediately when live tool data is available', async () => {
    const service = new AIReplyService();
    const reply = await service.generateReply({
      phone: '+919000000000',
      leadStage: 'ENGAGED',
      buyerType: 'PERSONAL',
      intents: ['order_summary_request'],
      entities: {},
      nextAction: 'EDUCATE',
      lastAssistantReply: 'Please complete the payment and share a screenshot.',
      groundedReplyHint:
        'You currently have 2 dozen Large Devgad Alphonso in draft for Mumbai delivery. If you want, I can help you confirm it or make changes.',
    });

    expect(generateCompletion).not.toHaveBeenCalled();
    expect(reply).toContain('2 dozen Large Devgad Alphonso');
  });
});
