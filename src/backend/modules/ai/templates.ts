import type { AIReplyContext } from './provider';

/**
 * Deterministic templates for critical sales flows.
 * These ensure consistency and accuracy when exactness is required.
 */
export const DETERMINISTIC_TEMPLATES: Record<string, (context: AIReplyContext) => string> = {
  GREET: (_) =>
    `Hello! Welcome to The Mango Lover Shop. I can help you with the finest Devgad Alphonso mangoes, naturally ripened and direct from the orchard. What can I get for you today?`,

  COLLECT_QUANTITY_AND_CITY: (_) =>
    `Our premium Devgad batch is looking great right now. Just tell me how many dozen you need and the delivery city, and I'll share the best quote for you.`,

  REQUEST_PAYMENT: (ctx) => {
    const summary = ctx.orderSummary || 'your order';
    return `Perfect choice. For ${summary}, you can complete the payment using the UPI details below. Once you're done, just share the screenshot here and I'll handle the rest.`;
  },

  CONFIRM_ORDER: (_) =>
    `Payment verified. Thank you! I've confirmed your order with The Mango Lover Shop. I'll send over the tracking details as soon as your premium batch is dispatched.`,

  ESCALATE_HUMAN: (_) =>
    `Understood. I'm looping in one of our team members to help you with this directly. Please give us just a moment.`,

  HANDLE_COMPLAINT: (_) =>
    `I'm really sorry to hear that. I've flagged this to our quality team immediately, and a manager will reach out to you personally to make this right.`,

  COLLECT_ADDRESS: (_) =>
    `I've got the order details. Now, just share your full delivery address with the landmark and 6-digit pin code so we can ensure a smooth delivery.`,
};
