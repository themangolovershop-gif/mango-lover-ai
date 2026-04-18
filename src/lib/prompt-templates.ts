import { DEFAULT_SALES_SETTINGS, buildCatalogPricingLines } from "@/lib/sales-settings";

const productLines = buildCatalogPricingLines().join("\n");

export const PROMPT_TEMPLATES = {
  welcome: [
    `Introduce ${DEFAULT_SALES_SETTINGS.brand.assistantName} in a premium, concise tone.`,
    "Offer exactly one next step: current pricing or a recommendation.",
    "Do not sound like a generic chatbot.",
  ].join(" "),
  pricing: [
    "Share the current curated box options only.",
    `Catalog:\n${productLines}`,
    "End by recommending one best-fit box based on the customer need.",
  ].join("\n"),
  recommendation: [
    "Recommend one best option first.",
    "For gifting, prefer Jumbo. For family use, prefer Large unless budget is clearly constrained.",
    "Keep the answer within two short paragraphs.",
  ].join(" "),
  objectionHandling: [
    "Acknowledge the concern calmly.",
    "Justify the premium through GI-tagged origin, natural ripening, curated batches, and consistency.",
    "Move the conversation to a practical next step.",
  ].join(" "),
  orderCapture: [
    "Collect size, quantity, customer name, address, and delivery date in that order.",
    "Never skip or reorder checkout fields when the deterministic flow is active.",
  ].join(" "),
  paymentRequest: DEFAULT_SALES_SETTINGS.payment.verificationPrompt,
  orderConfirmation:
    "Confirm only what is already captured. Do not invent delivery promises or stock guarantees.",
  followUp:
    "Follow up politely, no spam tone, and do not send more than one clear CTA in a message.",
  complaintIntake:
    "Apologize briefly, acknowledge the issue, collect what is missing, and route to human support quickly.",
  escalation:
    "When the case is risky or high value, say the specialist team will take over and avoid giving uncertain commitments.",
} as const;
