import { AIReplyContext } from './provider';

/**
 * Deterministic templates for critical sales flows.
 * These ensure consistency and accuracy when exactness is required.
 */
export const DETERMINISTIC_TEMPLATES: Record<string, (context: AIReplyContext) => string> = {
  GREET: (_) => 
    `Hello! Welcome to The Mango Lover Shop. We specialize in authentic GI-tagged Devgad Alphonso mangoes, naturally ripened and carbide-free. How can I help you today?`,

  COLLECT_QUANTITY_AND_CITY: (_) => 
    `Our premium Devgad Alphonsos are currently in season. To share the latest pricing and delivery timelines, could you please specify the quantity (in dozens) and your delivery city?`,

  REQUEST_PAYMENT: (ctx) => {
    const summary = ctx.orderSummary || 'your order';
    return `Thank you for the details. For ${summary}, please complete the payment using the UPI details below and share a screenshot here. Once confirmed, we will process your delivery.`;
  },

  CONFIRM_ORDER: (_) => 
    `Payment received and verified. Thank you for your order with The Mango Lover Shop. You will receive tracking details once your mangoes are dispatched.`,

  ESCALATE_HUMAN: (_) => 
    `I've noted your request. I am connecting you with a member of our team who can assist you further with this. Please wait a moment.`,

  HANDLE_COMPLAINT: (_) => 
    `I am very sorry to hear about the issue with your order. I have escalated this to our quality team immediately. A manager will reach out to you shortly to resolve this.`,
  
  COLLECT_ADDRESS: (_) =>
    `Could you please provide your full delivery address, including the landmark and 6-digit pin code? This will help us ensure a smooth delivery.`
};
