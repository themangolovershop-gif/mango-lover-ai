import { supabase } from "@/lib/supabase";
import {
  calculateOrderValue,
  isLockedCheckoutState,
  nextCheckoutStateFromOrder,
  normalizeSalesStateValue,
  reconcileSalesState,
  sizeLabel,
  sizePrice,
} from "@/lib/sales-analytics";
import {
  analyzeCustomerMessage,
  normalizeInboundText,
} from "@/lib/sales-intelligence";
import { buildCatalogPricingLines, DEFAULT_SALES_SETTINGS } from "@/lib/sales-settings";
import type { CustomerMessageAnalysis } from "@/lib/sales-platform-contracts";
import type {
  Conversation,
  CustomerIntent,
  LeadTag,
  Order,
  OrderType,
  ProductSize,
  SalesReply,
  SalesState,
} from "@/lib/types";

export {
  calculateOrderValue,
  isLockedCheckoutState,
  nextCheckoutStateFromOrder,
  normalizeSalesStateValue,
  reconcileSalesState,
  sizeLabel,
  sizePrice,
};
export type { SalesStateReconciliation } from "@/lib/sales-analytics";

export type ParsedSalesInput = {
  intent: CustomerIntent;
  productSize: ProductSize | null;
  quantity: number | null;
  isConfirmation: boolean;
  isUpsellAccept: boolean;
  isEdit: boolean;
  wantsHuman: boolean;
  isGreeting: boolean;
  analysis: CustomerMessageAnalysis;
};

type OrderPatch = Partial<
  Pick<
    Order,
    | "customer_name"
    | "product_size"
    | "quantity"
    | "delivery_address"
    | "delivery_date"
    | "order_type"
    | "status"
    | "notes"
  >
>;

export type DeterministicTransition = {
  handled: boolean;
  nextState: SalesState;
  orderPatch: OrderPatch | null;
  leadTag: LeadTag;
  lastCustomerIntent: CustomerIntent;
};

type QuantityMatch = {
  quantity: number;
  token: string;
};

type CombinedSelection = {
  productSize: ProductSize;
  quantity: number;
  customerName: string | null;
};

const GREETING_KEYWORDS = ["hi", "hello", "hey", "hii"];
const PRICE_KEYWORDS = [
  "price",
  "rate",
  "cost",
  "kitna",
  "pricing",
  "bhav",
  "price list",
];
const EXACT_CONFIRM_MESSAGES = ["confirm", "book", "yes confirm", "confirm order", "book order"];
const UPSELL_KEYWORDS = ["upgrade", "add", "yes add", "make it 2", "yes"];
const EDIT_KEYWORDS = ["edit order", "edit", "change order", "modify", "change"];
const DIRECT_SIZE_MESSAGES: ProductSize[] = ["medium", "large", "jumbo"];

function buildWelcomeReply(): string {
  return [
    `Welcome to ${DEFAULT_SALES_SETTINGS.brand.businessName}.`,
    "",
    "I can help with pricing, a recommendation, or a booking. Would you like to see prices or hear the best box for your requirement?",
  ].join("\n");
}

function buildPricingReply(): string {
  return [
    ...buildCatalogPricingLines(),
    "",
    "Large is the most balanced pick for most home orders. Which size would you like to reserve?",
  ].join("\n");
}

function buildConfirmedReply(): string {
  return [
    "Your order is confirmed.",
    "",
    "We will prepare the batch and share the next update shortly.",
  ].join("\n");
}

function buildOrderSummary(order: {
  customer_name: string | null | undefined;
  product_size: ProductSize | null | undefined;
  quantity: number | null | undefined;
  delivery_address: string | null | undefined;
  delivery_date: string | null | undefined;
  notes?: string | null;
}): SalesReply {
  const summary = [
    "Order Summary",
    "",
    `Name: ${order.customer_name || "-"}`,
    `Product: ${order.product_size ? sizeLabel(order.product_size) : "-"}`,
    `Quantity: ${order.quantity ?? "-"}`,
    `Address: ${order.delivery_address || "-"}`,
    `Delivery: ${order.delivery_date || "-"}`,
    "",
  ];

  const hasUpsell = order.notes?.includes("Upsell Accepted");

  if (order.quantity === 1 && !hasUpsell) {
    summary.push(
      `If you'd like, I can add one more ${order.product_size ? sizeLabel(order.product_size) : "premium"} box at Rs 200 off before confirmation.`
    );

    return {
      text: summary.join("\n"),
      buttons: [
        { id: "confirm", title: "CONFIRM" },
        { id: "upgrade", title: "UPGRADE (+1 Box)" },
        { id: "edit", title: "EDIT ORDER" },
      ],
    };
  }

  return {
    text: summary.join("\n"),
    buttons: [
      { id: "confirm", title: "CONFIRM" },
      { id: "edit", title: "EDIT ORDER" },
    ],
  };
}

function buildSummarySource(order: Order | null) {
  return {
    customer_name: order?.customer_name ?? null,
    product_size: order?.product_size ?? null,
    quantity: order?.quantity ?? null,
    delivery_address: order?.delivery_address ?? null,
    delivery_date: order?.delivery_date ?? null,
    notes: order?.notes ?? null,
  };
}

function buildOrderType(intent: CustomerIntent, existingOrder: Order | null): OrderType {
  if (intent === "gift") return "gift";
  if (intent === "corporate") return "corporate";
  if (intent === "subscription") return "subscription";
  return existingOrder?.order_type || "personal";
}

function buildEscalationReply(parsed: ParsedSalesInput): string {
  if (
    parsed.analysis.intents.includes("complaint") ||
    parsed.analysis.intents.includes("refund")
  ) {
    return [
      "I am sorry this was not right.",
      "",
      "I am moving this to our team now so it can be handled properly.",
    ].join("\n");
  }

  if (
    parsed.analysis.intents.includes("corporate_order") ||
    parsed.analysis.intents.includes("bulk_order")
  ) {
    return [
      "This looks like a larger requirement.",
      "",
      "I am moving it to our team so pricing, batching, and delivery can be handled correctly.",
    ].join("\n");
  }

  return [
    "Understood.",
    "",
    "I am moving this chat to a human team member now. Please wait a moment.",
  ].join("\n");
}

function buildRecommendationReply(parsed: ParsedSalesInput): string {
  if (parsed.analysis.entities.giftingIntent) {
    return [
      "For gifting, Jumbo is the best fit.",
      "",
      "It gives the strongest presentation and is the premium choice for special orders. If you'd like, I can start the booking now.",
    ].join("\n");
  }

  return [
    "For most home orders, Large is the best fit.",
    "",
    "It balances presentation, taste, and value very well. Tell me the quantity you want, and I will prepare the draft.",
  ].join("\n");
}

function buildPaymentUpdateReply(): string {
  return [
    "Payment noted.",
    "",
    DEFAULT_SALES_SETTINGS.payment.verificationPrompt,
  ].join("\n");
}

function buildAvailabilityReply(parsed: ParsedSalesInput): string {
  const city = parsed.analysis.entities.city;
  const cityLine = city
    ? `We can check the current batch for ${city}.`
    : "We can check the current batch for your delivery city.";

  return [
    cityLine,
    "",
    "Tell me the size and quantity you want, and I will guide you on the next step.",
  ].join("\n");
}

function buildPriceObjectionReply(): string {
  return [
    "I understand.",
    "",
    "Our batches are GI-tagged Devgad Alphonso, naturally ripened, and curated for consistency. If you'd like, I can suggest the most balanced box for your requirement.",
  ].join("\n");
}

function buildQualityTrustReply(): string {
  return [
    "Every batch is GI-tagged Devgad Alphonso, naturally ripened, and curated before dispatch.",
    "",
    "If you'd like, I can guide you to the right box now.",
  ].join("\n");
}

function buildCorporateReply(): string {
  return [
    "We handle premium gifting and larger orders as well.",
    "",
    "Share the quantity and delivery city, and I will guide you on the right next step.",
  ].join("\n");
}

function buildRepeatOrderReply(): string {
  return [
    "Welcome back.",
    "",
    "Tell me the size and quantity you would like this time, and I will prepare the draft quickly.",
  ].join("\n");
}

function appendNextStep(reply: string, nextStep: string): string {
  return [reply, "", nextStep].join("\n");
}

function buildLockedCheckoutAssistReply(args: {
  state: SalesState;
  parsed: ParsedSalesInput;
  order: Order | null;
  rawMessage: string;
}): string | null {
  const { state, parsed, order, rawMessage } = args;
  const nextStep = getCheckoutFallback(state);

  if (parsed.analysis.intents.includes("pricing") || isPriceMessage(rawMessage)) {
    if (order?.product_size) {
      return appendNextStep(
        `${sizeLabel(order.product_size)} is Rs ${sizePrice(order.product_size)} per box.`,
        nextStep
      );
    }

    return appendNextStep(buildPricingReply(), nextStep);
  }

  if (parsed.analysis.intents.includes("recommendation_request")) {
    return appendNextStep(buildRecommendationReply(parsed), nextStep);
  }

  if (
    parsed.analysis.intents.includes("delivery_check") ||
    parsed.analysis.intents.includes("availability_check")
  ) {
    return appendNextStep(buildAvailabilityReply(parsed), nextStep);
  }

  if (
    parsed.analysis.intents.includes("quality_check") ||
    parsed.analysis.intents.includes("authenticity_check")
  ) {
    return appendNextStep(buildQualityTrustReply(), nextStep);
  }

  if (parsed.analysis.intents.includes("gifting")) {
    return appendNextStep(buildRecommendationReply(parsed), nextStep);
  }

  if (
    parsed.analysis.intents.includes("corporate_order") ||
    parsed.analysis.intents.includes("bulk_order")
  ) {
    return appendNextStep(buildCorporateReply(), nextStep);
  }

  if (parsed.analysis.intents.includes("repeat_order")) {
    return appendNextStep(buildRepeatOrderReply(), nextStep);
  }

  if (
    parsed.analysis.intents.includes("discount_request") ||
    parsed.analysis.intents.includes("objection_price")
  ) {
    return appendNextStep(buildPriceObjectionReply(), nextStep);
  }

  return null;
}

function buildConfirmedStateReply(parsed: ParsedSalesInput, rawMessage: string): string {
  if (parsed.isConfirmation) {
    return buildConfirmedReply();
  }

  const nextOrderPrompt =
    "Your last order is already confirmed. If you need another booking, send the size and quantity, or tell me if you need help with the confirmed order.";

  if (parsed.analysis.intents.includes("pricing") || isPriceMessage(rawMessage)) {
    return appendNextStep(buildPricingReply(), nextOrderPrompt);
  }

  if (
    parsed.analysis.intents.includes("delivery_check") ||
    parsed.analysis.intents.includes("availability_check")
  ) {
    return appendNextStep(buildAvailabilityReply(parsed), nextOrderPrompt);
  }

  if (
    parsed.analysis.intents.includes("quality_check") ||
    parsed.analysis.intents.includes("authenticity_check")
  ) {
    return appendNextStep(buildQualityTrustReply(), nextOrderPrompt);
  }

  if (
    parsed.analysis.intents.includes("recommendation_request") ||
    parsed.analysis.intents.includes("gifting")
  ) {
    return appendNextStep(buildRecommendationReply(parsed), nextOrderPrompt);
  }

  if (
    parsed.analysis.intents.includes("corporate_order") ||
    parsed.analysis.intents.includes("bulk_order")
  ) {
    return appendNextStep(buildCorporateReply(), nextOrderPrompt);
  }

  if (parsed.analysis.intents.includes("repeat_order")) {
    return appendNextStep(buildRepeatOrderReply(), nextOrderPrompt);
  }

  if (
    parsed.analysis.intents.includes("discount_request") ||
    parsed.analysis.intents.includes("objection_price")
  ) {
    return appendNextStep(buildPriceObjectionReply(), nextOrderPrompt);
  }

  return nextOrderPrompt;
}

function stripTrailingPunctuation(input: string): string {
  return input.replace(/[!.,?]+$/g, "");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isGreetingMessage(message: string): boolean {
  const normalized = stripTrailingPunctuation(normalizeText(message));
  return GREETING_KEYWORDS.includes(normalized);
}

function isPriceMessage(text: string): boolean {
  return PRICE_KEYWORDS.some((keyword) => {
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    return regex.test(text);
  });
}

function isConfirmationMessage(message: string): boolean {
  const text = normalizeText(message);
  return EXACT_CONFIRM_MESSAGES.includes(text);
}

function isUpsellMessage(message: string): boolean {
  const text = normalizeText(message);
  return UPSELL_KEYWORDS.includes(text);
}

function isEditMessage(message: string): boolean {
  const text = normalizeText(message);
  return EDIT_KEYWORDS.includes(text);
}

function isExactSizeMessage(message: string): boolean {
  const text = normalizeText(message);
  return DIRECT_SIZE_MESSAGES.includes(text as ProductSize);
}

function parseQuantityValue(input: string): number | null {
  const normalized = normalizeText(input);
  const match = normalized.match(
    /^(\d+)\s*(dozen|doz|dzn|boxes|box|pc|pcs|kg|unit|units|peti|crate|carton|qty)?$/
  );

  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isInteger(value) || value <= 0 || value > 100) return null;

  return value;
}

function extractQuantityMatch(message: string): QuantityMatch | null {
  const normalized = normalizeText(message);
  const regex =
    /(^|[^a-z0-9])(\d+\s*(dozen|doz|dzn|boxes|box|pc|pcs|kg|unit|units|peti|crate|carton|qty)?)(?=$|[^a-z0-9])/gi;
  const matches = [...normalized.matchAll(regex)];

  if (matches.length !== 1) return null;

  const token = matches[0][2].trim();
  const quantity = parseQuantityValue(token);
  if (quantity === null) return null;

  return { quantity, token };
}

function extractEmbeddedQuantity(message: string): number | null {
  return extractQuantityMatch(message)?.quantity ?? null;
}

function isLikelyName(message: string): boolean {
  const trimmed = message.trim();
  const normalized = stripTrailingPunctuation(normalizeText(trimmed));

  if (trimmed.includes("?")) return false;
  if (!normalized || normalized.length < 2) return false;
  if (/\d/.test(normalized)) return false;

  const words = normalized.split(/\s+/);
  if (words.length > 5) return false;

  const smallTalk = [
    "yes",
    "no",
    "ok",
    "okay",
    "thanks",
    "thank",
    "sure",
    "now",
    "where",
    "how",
    "you",
    "there",
    "wait",
    "hello",
    "hi",
    "hey",
  ];
  if (words.length === 1 && smallTalk.includes(words[0])) return false;

  if (isGreetingMessage(normalized) || isPriceMessage(normalized) || isConfirmationMessage(normalized)) {
    return false;
  }
  if (extractProductSize(normalized) || extractEmbeddedQuantity(normalized) !== null) return false;

  return /^[a-z][a-z\s.'-]*$/i.test(trimmed);
}

function extractCombinedSelection(message: string): CombinedSelection | null {
  const productSize = extractProductSize(message);
  const quantityMatch = extractQuantityMatch(message);

  if (!productSize || !quantityMatch) return null;

  let leftover = message.trim();
  leftover = leftover.replace(new RegExp(`\\b${productSize}\\b`, "i"), " ");
  leftover = leftover.replace(new RegExp(escapeRegExp(quantityMatch.token), "i"), " ");
  leftover = leftover.replace(/[\n,;|]+/g, " ");
  leftover = leftover.replace(/\s+/g, " ").trim();

  return {
    productSize,
    quantity: quantityMatch.quantity,
    customerName: isLikelyName(leftover) ? leftover : null,
  };
}

function splitCheckoutSegments(message: string): string[] {
  return message
    .split(/[\n,;|]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function buildCheckoutReply(state: SalesState, order: Order | null): string | SalesReply {
  switch (state) {
    case "awaiting_quantity":
      return "Good choice.\n\nHow many boxes would you like?";
    case "awaiting_name":
      return "May I have your name for this order?";
    case "awaiting_address":
      return "Please share the full delivery address, including pin code if available.";
    case "awaiting_date":
      return "When would you like delivery?";
    case "awaiting_confirmation":
      return buildOrderSummary(buildSummarySource(order));
    case "confirmed":
      return buildConfirmedReply();
    default:
      return "I can share pricing or begin the order. Which would you prefer?";
  }
}

function deriveLeadTagForState(args: {
  nextState: SalesState;
  parsed: ParsedSalesInput;
  orderAfter: Order | null;
}): LeadTag {
  const { nextState, parsed, orderAfter } = args;

  if (nextState === "human_handoff") return "human_required";
  if (parsed.analysis.buyerType === "corporate") return "corporate_lead";
  if (parsed.analysis.buyerType === "gifting") return "gift_lead";
  if (parsed.analysis.buyerType === "repeat") return "repeat_customer";
  if (isLockedCheckoutState(nextState) || parsed.analysis.temperature === "hot") return "hot";

  return deriveLeadTag(parsed.intent, orderAfter?.quantity ?? parsed.quantity, parsed.analysis);
}

function mapAnalysisToLegacyIntent(analysis: CustomerMessageAnalysis): CustomerIntent {
  if (
    analysis.intents.includes("human_help_request") ||
    analysis.intents.includes("complaint") ||
    analysis.intents.includes("refund")
  ) {
    return "human_support";
  }

  if (
    analysis.intents.includes("corporate_order") ||
    analysis.intents.includes("bulk_order")
  ) {
    return "corporate";
  }

  if (analysis.intents.includes("gifting")) return "gift";
  if (analysis.intents.includes("pricing")) return "price";

  if (
    analysis.intents.includes("delivery_check") ||
    analysis.intents.includes("availability_check")
  ) {
    return "delivery";
  }

  if (
    analysis.intents.includes("quality_check") ||
    analysis.intents.includes("authenticity_check")
  ) {
    return "quality_trust";
  }

  if (
    analysis.intents.includes("recommendation_request") ||
    analysis.intents.includes("order_start") ||
    analysis.intents.includes("product_selection") ||
    analysis.intents.includes("address_submission") ||
    analysis.intents.includes("payment_update") ||
    analysis.intents.includes("order_confirmation_request") ||
    analysis.intents.includes("discount_request") ||
    analysis.intents.includes("objection_price") ||
    analysis.intents.includes("repeat_order")
  ) {
    return "ready_to_buy";
  }

  return "confused";
}

export function normalizeText(input: string): string {
  return normalizeInboundText(input);
}

export function detectIntent(message: string): CustomerIntent {
  return mapAnalysisToLegacyIntent(analyzeCustomerMessage({ rawText: message }));
}

export function extractProductSize(message: string): ProductSize | null {
  return analyzeCustomerMessage({ rawText: message }).entities.productSize;
}

export function extractQuantity(message: string): number | null {
  const analysis = analyzeCustomerMessage({ rawText: message });
  return analysis.entities.quantity?.value ?? parseQuantityValue(message);
}

export function parseSalesInput(message: string): ParsedSalesInput {
  const analysis = analyzeCustomerMessage({ rawText: message });

  return {
    intent: mapAnalysisToLegacyIntent(analysis),
    productSize: analysis.entities.productSize,
    quantity: analysis.entities.quantity?.value ?? parseQuantityValue(message),
    isConfirmation: isConfirmationMessage(message),
    isUpsellAccept: isUpsellMessage(message),
    isEdit: isEditMessage(message),
    wantsHuman:
      analysis.intents.includes("human_help_request") || analysis.escalation.autoHandoff,
    isGreeting: isGreetingMessage(message),
    analysis,
  };
}

export function deriveLeadTag(
  intent: CustomerIntent,
  quantity: number | null,
  analysis?: CustomerMessageAnalysis
): LeadTag {
  if (analysis?.escalation.autoHandoff || intent === "human_support") return "human_required";
  if (
    analysis?.buyerType === "corporate" ||
    intent === "corporate" ||
    (quantity !== null && quantity >= 5)
  ) {
    return "corporate_lead";
  }
  if (analysis?.buyerType === "gifting" || intent === "gift") return "gift_lead";
  if (analysis?.buyerType === "repeat") return "repeat_customer";
  if (analysis?.temperature === "hot" || intent === "ready_to_buy") return "hot";
  if (intent === "price") return "price_seeker";
  if (analysis?.temperature === "cold") return "cold";
  return "warm";
}

export function getDeterministicTransition(args: {
  conversation: Conversation;
  parsed: ParsedSalesInput;
  order: Order | null;
  rawMessage: string;
}): DeterministicTransition {
  const { conversation, parsed, order, rawMessage } = args;
  const currentState = normalizeSalesStateValue(conversation.sales_state);
  const trimmedMessage = rawMessage.trim();
  const segments = splitCheckoutSegments(rawMessage);
  const combinedInput = extractCombinedSelection(rawMessage);
  const standaloneQuantity = parsed.quantity;
  const selectedSize = parsed.productSize;
  const canTriggerGreeting = currentState === "new" || currentState === "browsing";
  const canShowPrice = currentState === "new" || currentState === "browsing";

  let handled = false;
  let nextState = currentState;
  let orderPatch: OrderPatch | null = null;

  // INTERRUPT DETECTION: If the user says "cancel", "reset", or "help",
  // we MUST stop the deterministic machine and let the AI handle the pivot.
  const isInterrupt = 
    parsed.analysis.intents.includes("cancellation") || 
    parsed.analysis.intents.includes("restart_order_request") || 
    parsed.analysis.intents.includes("reset_conversation") ||
    parsed.analysis.intents.includes("human_help_request");

  if (isInterrupt && currentState !== "new" && currentState !== "browsing") {
    return {
      handled: false,
      nextState: currentState,
      orderPatch: null,
      leadTag: conversation.lead_tag || "warm",
      lastCustomerIntent: parsed.intent,
    };
  }

  if (parsed.analysis.escalation.autoHandoff || parsed.wantsHuman) {
    handled = true;
    nextState = "human_handoff";
  } else if (
    currentState === "confirmed" &&
    (parsed.isEdit || parsed.analysis.intents.includes("edit_order_request"))
  ) {
    handled = true;
    nextState = "human_handoff";
  } else if (currentState === "confirmed" && parsed.isConfirmation) {
    handled = true;
    nextState = "confirmed";
  } else if (currentState === "awaiting_quantity") {
    handled = true;

    if (combinedInput) {
      orderPatch = {
        product_size: combinedInput.productSize,
        quantity: combinedInput.quantity,
        order_type: buildOrderType(parsed.intent, order),
      };
      nextState = combinedInput.customerName ? "awaiting_address" : "awaiting_name";

      if (combinedInput.customerName) {
        orderPatch.customer_name = combinedInput.customerName;
      }
    } else if (standaloneQuantity !== null) {
      orderPatch = {
        quantity: standaloneQuantity,
        order_type: buildOrderType(parsed.intent, order),
      };
      nextState = "awaiting_name";
    } else if (selectedSize) {
      orderPatch = {
        product_size: selectedSize,
        order_type: buildOrderType(parsed.intent, order),
      };
      nextState = "awaiting_quantity";
    }
  } else if (currentState === "awaiting_name") {
    handled = true;

    if (combinedInput) {
      orderPatch = {
        product_size: combinedInput.productSize,
        quantity: combinedInput.quantity,
        order_type: buildOrderType(parsed.intent, order),
      };
      nextState = "awaiting_name";

      if (combinedInput.customerName) {
        orderPatch.customer_name = combinedInput.customerName;
        nextState = "awaiting_address";
      }
    } else if (selectedSize) {
      orderPatch = {
        product_size: selectedSize,
        order_type: buildOrderType(parsed.intent, order),
      };
      nextState = "awaiting_name";
    } else if (parsed.isGreeting || isPriceMessage(rawMessage)) {
      nextState = "awaiting_name";
    } else {
      const candidateName = segments[0] || trimmedMessage;

      if (isLikelyName(candidateName)) {
        orderPatch = {
          customer_name: candidateName,
          order_type: buildOrderType(parsed.intent, order),
        };
        nextState = "awaiting_address";

        if (segments[1]) {
          orderPatch.delivery_address = segments[1];
          nextState = "awaiting_date";
        }

        if (segments[2]) {
          orderPatch.delivery_date = segments[2];
          orderPatch.status = "awaiting_confirmation";
          nextState = "awaiting_confirmation";
        }
      } else {
        nextState = "awaiting_name";
      }
    }
  } else if (currentState === "awaiting_address") {
    handled = true;

    if (combinedInput) {
      orderPatch = {
        product_size: combinedInput.productSize,
        quantity: combinedInput.quantity,
        order_type: buildOrderType(parsed.intent, order),
      };
      nextState = "awaiting_address";
    } else if (selectedSize) {
      orderPatch = {
        product_size: selectedSize,
        order_type: buildOrderType(parsed.intent, order),
      };
      nextState = "awaiting_address";
    } else if (parsed.isGreeting || isPriceMessage(rawMessage)) {
      nextState = "awaiting_address";
    } else if (trimmedMessage) {
      orderPatch = {
        delivery_address: segments[0] || trimmedMessage,
        order_type: buildOrderType(parsed.intent, order),
      };
      nextState = "awaiting_date";

      if (segments[1]) {
        orderPatch.delivery_date = segments[1];
        orderPatch.status = "awaiting_confirmation";
        nextState = "awaiting_confirmation";
      }
    }
  } else if (currentState === "awaiting_date") {
    handled = true;

    if (combinedInput) {
      orderPatch = {
        product_size: combinedInput.productSize,
        quantity: combinedInput.quantity,
        order_type: buildOrderType(parsed.intent, order),
      };
      nextState = "awaiting_date";
    } else if (selectedSize) {
      orderPatch = {
        product_size: selectedSize,
        order_type: buildOrderType(parsed.intent, order),
      };
      nextState = "awaiting_date";
    } else if (parsed.isGreeting || isPriceMessage(rawMessage)) {
      nextState = "awaiting_date";
    } else if (trimmedMessage) {
      nextState = "awaiting_confirmation";
      orderPatch = {
        delivery_date: segments[0] || trimmedMessage,
        order_type: buildOrderType(parsed.intent, order),
        status: "awaiting_confirmation",
      };
    }
  } else if (currentState === "awaiting_confirmation") {
    handled = true;

    if (
      parsed.isUpsellAccept &&
      order?.quantity === 1 &&
      !order?.notes?.includes("Upsell Accepted")
    ) {
      orderPatch = {
        quantity: 2,
        notes: `${order.notes ? `${order.notes}\n` : ""}Upsell Accepted: Rs 200 discount`,
        order_type: buildOrderType(parsed.intent, order),
        status: "awaiting_confirmation",
      };
      nextState = "awaiting_confirmation";
    } else if (parsed.isConfirmation) {
      nextState = "confirmed";
      orderPatch = {
        order_type: buildOrderType(parsed.intent, order),
        status: "confirmed",
      };
    } else if (combinedInput) {
      orderPatch = {
        product_size: combinedInput.productSize,
        quantity: combinedInput.quantity,
        order_type: buildOrderType(parsed.intent, order),
        status: "awaiting_confirmation",
      };
      nextState = "awaiting_confirmation";
    } else if (selectedSize) {
      orderPatch = {
        product_size: selectedSize,
        order_type: buildOrderType(parsed.intent, order),
        status: "awaiting_confirmation",
      };
      nextState = "awaiting_confirmation";
    } else {
      nextState = "awaiting_confirmation";
    }
  } else if (canTriggerGreeting && parsed.isGreeting) {
    handled = true;
    nextState = "browsing";
  } else if (canShowPrice && isPriceMessage(rawMessage)) {
    handled = true;
    nextState = "browsing";
  } else if (combinedInput) {
    handled = true;
    orderPatch = {
      product_size: combinedInput.productSize,
      quantity: combinedInput.quantity,
      customer_name: null,
      delivery_address: null,
      delivery_date: null,
      order_type: buildOrderType(parsed.intent, order),
      status: "draft",
    };
    nextState = "awaiting_name";

    if (combinedInput.customerName) {
      orderPatch.customer_name = combinedInput.customerName;
      nextState = "awaiting_address";
    }
  } else if (selectedSize) {
    handled = true;
    orderPatch = {
      product_size: selectedSize,
      quantity: null,
      customer_name: null,
      delivery_address: null,
      delivery_date: null,
      order_type: buildOrderType(parsed.intent, order),
      status: "draft",
    };
    nextState = "awaiting_quantity";
  } else if (
    (currentState === "new" || currentState === "browsing") &&
    order?.product_size &&
    standaloneQuantity !== null
  ) {
    handled = true;
    nextState = "awaiting_name";
    orderPatch = {
      quantity: standaloneQuantity,
      order_type: buildOrderType(parsed.intent, order),
    };
  }

  const orderAfter = order
    ? ({
        ...order,
        ...(orderPatch || {}),
      } as Order)
    : orderPatch
      ? ({
          id: "",
          conversation_id: conversation.id,
          customer_name: null,
          phone: conversation.phone,
          product_size: null,
          quantity: null,
          delivery_address: null,
          delivery_date: null,
          order_type: buildOrderType(parsed.intent, order),
          status: "draft",
          notes: null,
          created_at: "",
          updated_at: "",
          ...orderPatch,
        } as Order)
      : null;

  const finalState = handled ? nextState : currentState;

  return {
    handled,
    nextState: finalState,
    orderPatch,
    leadTag: deriveLeadTagForState({
      nextState: finalState,
      parsed,
      orderAfter,
    }),
    lastCustomerIntent: parsed.intent,
  };
}

export function buildSalesReply(
  conversation: Conversation,
  parsed: ParsedSalesInput,
  order: Order | null,
  rawMessage: string,
  options?: {
    allowCheckoutAssist?: boolean;
  }
): string | SalesReply | null {
  const state = normalizeSalesStateValue(conversation.sales_state);
  const canTriggerGreeting = state === "new" || state === "browsing";
  const checkoutLocked = isLockedCheckoutState(state) && state !== "confirmed";
  const allowCheckoutAssist = options?.allowCheckoutAssist ?? true;

  if (parsed.analysis.escalation.autoHandoff || parsed.wantsHuman) {
    return buildEscalationReply(parsed);
  }

  if (state === "human_handoff") {
    return buildEscalationReply(parsed);
  }

  if (state === "awaiting_confirmation" && parsed.isEdit) {
    return {
      text: "Tell me exactly what you would like to change, and I will update the draft.",
    };
  }

  const checkoutAssistReply = checkoutLocked && allowCheckoutAssist
    ? buildLockedCheckoutAssistReply({
        state,
        parsed,
        order,
        rawMessage,
      })
    : null;

  if (checkoutAssistReply) {
    return checkoutAssistReply;
  }

  if (checkoutLocked) {
    return buildCheckoutReply(state, order);
  }

  if (canTriggerGreeting && parsed.isGreeting) {
    return buildWelcomeReply();
  }

  if (canTriggerGreeting && isPriceMessage(rawMessage)) {
    return buildPricingReply();
  }

  if (state === "confirmed") {
    const isEditOrCancel = 
      parsed.isEdit || 
      parsed.analysis.intents.includes("cancellation") ||
      parsed.analysis.intents.includes("edit_order_request") ||
      parsed.analysis.intents.includes("human_help_request");

    if (isEditOrCancel) {
      return null; // Fallback to AI/Human for complex edits
    }

    return buildConfirmedStateReply(parsed, rawMessage);
  }

  if (parsed.analysis.intents.includes("payment_update")) {
    return buildPaymentUpdateReply();
  }

  if (parsed.analysis.intents.includes("recommendation_request")) {
    return buildRecommendationReply(parsed);
  }

  if (parsed.productSize || isExactSizeMessage(rawMessage)) {
    return buildCheckoutReply("awaiting_quantity", order);
  }

  if (parsed.analysis.intents.includes("delivery_check")) {
    return buildAvailabilityReply(parsed);
  }

  if (
    parsed.analysis.intents.includes("quality_check") ||
    parsed.analysis.intents.includes("authenticity_check")
  ) {
    return buildQualityTrustReply();
  }

  if (parsed.analysis.intents.includes("gifting")) {
    return buildRecommendationReply(parsed);
  }

  if (
    parsed.analysis.intents.includes("corporate_order") ||
    parsed.analysis.intents.includes("bulk_order")
  ) {
    return buildCorporateReply();
  }

  if (parsed.analysis.intents.includes("repeat_order")) {
    return buildRepeatOrderReply();
  }

  if (
    parsed.analysis.intents.includes("discount_request") ||
    parsed.analysis.intents.includes("objection_price")
  ) {
    return buildPriceObjectionReply();
  }

  if (parsed.quantity && !parsed.productSize && !order?.product_size) {
    return "Which size would you like: Medium, Large, or Jumbo?";
  }

  return null;
}

export function getCheckoutFallback(state: SalesState): string {
  switch (state) {
    case "awaiting_quantity":
      return "How many boxes would you like? For example, 2 boxes.";
    case "awaiting_name":
      return "I will need the customer name to continue this order.";
    case "awaiting_address":
      return "Please share the delivery address, including pin code if available.";
    case "awaiting_date":
      return "What delivery date should I note for this order?";
    case "awaiting_confirmation":
      return "Please confirm the order summary so I can lock it in.";
    default:
      return "Please share the next order detail so I can continue.";
  }
}

export async function getDraftOrder(conversationId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("conversation_id", conversationId)
    .in("status", ["draft", "awaiting_confirmation"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[WH-ERROR] Order fetch failed", error);
    return null;
  }

  return data as Order | null;
}

export async function persistDraftOrderPatch(args: {
  conversation: Conversation;
  existingOrder: Order | null;
  orderPatch: OrderPatch | null;
}) {
  const { conversation, existingOrder, orderPatch } = args;

  if (!orderPatch || Object.keys(orderPatch).length === 0) {
    return existingOrder;
  }

  if (existingOrder) {
    const { data, error } = await supabase
      .from("orders")
      .update({
        ...orderPatch,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingOrder.id)
      .select()
      .single();

    if (error) throw error;
    return data as Order;
  }

  const { data, error } = await supabase
    .from("orders")
    .insert({
      conversation_id: conversation.id,
      phone: conversation.phone,
      order_type: orderPatch.order_type || "personal",
      status: orderPatch.status || "draft",
      product_size: orderPatch.product_size ?? null,
      quantity: orderPatch.quantity ?? null,
      customer_name: orderPatch.customer_name ?? null,
      delivery_address: orderPatch.delivery_address ?? null,
      delivery_date: orderPatch.delivery_date ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as Order;
}

export async function updateConversationSalesFields(args: {
  conversationId: string;
  salesState: SalesState;
  leadTag: LeadTag;
  lastCustomerIntent: CustomerIntent;
  resetFollowUpCount: boolean;
  expectedUpdatedAt?: string;
  name?: string;
}) {
  const {
    conversationId,
    salesState,
    leadTag,
    lastCustomerIntent,
    resetFollowUpCount,
    expectedUpdatedAt,
    name,
  } = args;

  const patch: Record<string, unknown> = {
    sales_state: salesState,
    lead_tag: leadTag,
    last_customer_intent: lastCustomerIntent,
    updated_at: new Date().toISOString(),
  };

  if (name) patch.name = name;
  if (resetFollowUpCount) {
    patch.follow_up_count = 0;
  }

  let query = supabase.from("conversations").update(patch).eq("id", conversationId);

  if (expectedUpdatedAt) {
    query = query.eq("updated_at", expectedUpdatedAt);
  }

  const { data, error } = await query.select();

  if (error) {
    console.error("[WH-ERROR] Conversation sales fields update failed", error);
    throw error;
  }

  if (expectedUpdatedAt && (!data || data.length === 0)) {
    throw new Error("VERSION_CONFLICT");
  }
}
