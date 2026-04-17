import { supabase } from "@/lib/supabase";
import {
  isLockedCheckoutState,
  normalizeSalesStateValue,
  sizeLabel,
} from "@/lib/sales-analytics";
import type {
  Conversation,
  CustomerIntent,
  LeadTag,
  Order,
  OrderType,
  ProductSize,
  SalesState,
  SalesReply,
} from "@/lib/types";
export {
  calculateOrderValue,
  isLockedCheckoutState,
  nextCheckoutStateFromOrder,
  normalizeSalesStateValue,
  reconcileSalesState,
  sizeLabel,
  sizePrice,
} from "@/lib/sales-analytics";
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

const GREETING_KEYWORDS = ["hi", "hello", "hey", "hii"];
const PRICE_KEYWORDS = ["price", "rate", "cost", "kitna", "pricing", "bhav", "paise", "rate card", "price list"];
const DELIVERY_KEYWORDS = ["delivery", "ship", "shipping", "mumbai", "thane", "india", "pincode"];
const GIFT_KEYWORDS = ["gift", "gifting", "hamper"];
const CORPORATE_KEYWORDS = ["corporate", "bulk", "event", "office", "client", "business order"];
const SUBSCRIPTION_KEYWORDS = ["subscription", "weekly", "seasonal", "repeat"];
const HUMAN_KEYWORDS = ["human", "person", "call me", "team", "support", "talk to someone", "executive"];
const TRUST_KEYWORDS = ["original", "real", "authentic", "devgad", "gi", "quality", "organic"];
const STORE_KEYWORDS = ["store", "shop", "visit", "location", "address"];
const EXACT_CONFIRM_MESSAGES = ["confirm", "book", "yes confirm", "confirm order", "book order"];
const UPSELL_KEYWORDS = ["upgrade", "add", "yes add", "make it 2", "yes"];
const EDIT_KEYWORDS = ["edit order", "edit", "change order", "modify", "change"];
const DIRECT_SIZE_MESSAGES: ProductSize[] = ["medium", "large", "jumbo"];

type QuantityMatch = {
  quantity: number;
  token: string;
};

type CombinedSelection = {
  productSize: ProductSize;
  quantity: number;
  customerName: string | null;
};

function buildWelcomeReply(): string {
  return "🥭 Welcome to The Mango Lover Shop!\n\nWould you like to see prices or place an order?";
}

function buildPricingReply(): string {
  return [
    "🥭 Our premium Devgad Alphonso:",
    "",
    "Medium - ₹1499",
    "Large - ₹1999",
    "Jumbo - ₹2499",
    "",
    "Which one would you like?",
  ].join("\n");
}

function buildConfirmedReply(): string {
  return [
    "🥭 Your order is confirmed!",
    "",
    "We’ll prepare your premium mangoes and share updates shortly.",
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
    "🥭 Order Summary:",
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
    summary.push(`🎁 *Special Offer:* Add a 2nd box of ${order.product_size ? sizeLabel(order.product_size) : "premium"} mangoes at a ₹200 discount!`);
    
    return {
      text: summary.join("\n"),
      buttons: [
        { id: "confirm", title: "CONFIRM" },
        { id: "upgrade", title: "UPGRADE (+1 Box)" },
        { id: "edit", title: "EDIT ORDER" }
      ]
    };
  } else {
    return {
      text: summary.join("\n"),
      buttons: [
        { id: "confirm", title: "CONFIRM" },
        { id: "edit", title: "EDIT ORDER" }
      ]
    };
  }
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

// isQuantityMessage is handled by parseQuantityValue internally

function parseQuantityValue(input: string): number | null {
  const normalized = normalizeText(input);
  const match = normalized.match(
    /^(\d+)\s*(dozen|doz|boxes|box|pc|pcs|kg|unit|units|peti|crate|qty)?$/
  );

  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isInteger(value) || value <= 0 || value > 100) return null;

  return value;
}

function extractQuantityMatch(message: string): QuantityMatch | null {
  const normalized = normalizeText(message);
  const regex =
    /(^|[^a-z0-9])(\d+\s*(dozen|doz|boxes|box|pc|pcs|kg|unit|units|peti|crate|qty)?)(?=$|[^a-z0-9])/gi;
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

  // Names don't have question marks
  if (trimmed.includes("?")) return false;

  if (!normalized || normalized.length < 2) return false;
  
  // Names don't have digits
  if (/\d/.test(normalized)) return false;
  
  // Names are usually short but not single common words
  const words = normalized.split(/\s+/);
  if (words.length > 5) return false; // Too long for just a name

  const smallTalk = ["yes", "no", "ok", "okay", "thanks", "thank", "sure", "now", "where", "how", "you", "there", "wait", "hello", "hi", "hey"];
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
      return "Great choice 🥭\n\nHow many boxes would you like?";
    case "awaiting_name":
      return "Perfect 👍\n\nMay I have your name please?";
    case "awaiting_address":
      return "Please share your full delivery address.";
    case "awaiting_date":
      return "When would you like delivery?";
    case "awaiting_confirmation":
      return buildOrderSummary(buildSummarySource(order));
    case "confirmed":
      return buildConfirmedReply();
    default:
      return "Please tell me whether you want pricing or want to place an order.";
  }
}

function deriveLeadTagForState(args: {
  nextState: SalesState;
  parsed: ParsedSalesInput;
  orderAfter: Order | null;
}): LeadTag {
  const { nextState, parsed, orderAfter } = args;

  if (nextState === "human_handoff") return "human_required";
  if (isLockedCheckoutState(nextState)) return "hot";

  return deriveLeadTag(parsed.intent, orderAfter?.quantity ?? parsed.quantity);
}

export function normalizeText(input: string): string {
  return input.trim().toLowerCase();
}

export function detectIntent(message: string): CustomerIntent {
  const text = normalizeText(message);

  if (HUMAN_KEYWORDS.some((keyword) => text.includes(keyword))) return "human_support";
  if (CORPORATE_KEYWORDS.some((keyword) => text.includes(keyword))) return "corporate";
  if (SUBSCRIPTION_KEYWORDS.some((keyword) => text.includes(keyword))) return "subscription";
  if (GIFT_KEYWORDS.some((keyword) => text.includes(keyword))) return "gift";
  if (isPriceMessage(text)) return "price";
  if (DELIVERY_KEYWORDS.some((keyword) => text.includes(keyword))) return "delivery";
  if (TRUST_KEYWORDS.some((keyword) => text.includes(keyword))) return "quality_trust";
  if (STORE_KEYWORDS.some((keyword) => text.includes(keyword))) return "visit_store";
  if (extractProductSize(text) || extractQuantity(text)) return "ready_to_buy";

  return "confused";
}

export function extractProductSize(message: string): ProductSize | null {
  const text = normalizeText(message);

  if (/\bjumbo\b/.test(text)) return "jumbo";
  if (/\blarge\b/.test(text)) return "large";
  if (/\bmedium\b/.test(text)) return "medium";

  return null;
}

export function extractQuantity(message: string): number | null {
  return parseQuantityValue(message);
}

export function parseSalesInput(message: string): ParsedSalesInput {
  const normalized = normalizeText(message);

  return {
    intent: detectIntent(message),
    productSize: extractProductSize(message),
    quantity: extractQuantity(message),
    isConfirmation: isConfirmationMessage(message),
    isUpsellAccept: isUpsellMessage(message),
    isEdit: isEditMessage(message),
    wantsHuman: HUMAN_KEYWORDS.some((keyword) => {
      const regex = new RegExp(`\\b${keyword}\\b`, "i");
      return regex.test(normalized);
    }),
    isGreeting: isGreetingMessage(message),
  };
}

export function deriveLeadTag(intent: CustomerIntent, quantity: number | null): LeadTag {
  if (intent === "human_support") return "human_required";
  if (intent === "corporate" || (quantity !== null && quantity >= 5)) return "corporate_lead";
  if (intent === "subscription") return "subscription_lead";
  if (intent === "gift") return "gift_lead";
  if (intent === "ready_to_buy") return "hot";
  if (intent === "price") return "price_seeker";
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

  if (parsed.wantsHuman) {
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

    if (parsed.isUpsellAccept && order?.quantity === 1 && !order?.notes?.includes("Upsell Accepted")) {
      orderPatch = {
        quantity: 2,
        notes: (order.notes ? order.notes + "\n" : "") + "Upsell Accepted: ₹200 discount",
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
    } else if (parsed.isEdit) {
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
  } else if ((currentState === "new" || currentState === "browsing") && order?.product_size && standaloneQuantity !== null) {
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
  rawMessage: string
): string | SalesReply | null {
  const state = normalizeSalesStateValue(conversation.sales_state);
  const canTriggerGreeting = state === "new" || state === "browsing";

  if (parsed.wantsHuman) {
    return "Understood. I am moving this chat to a human team member now. Please wait a moment.";
  }

  if (state === "awaiting_confirmation") {
    if (parsed.isEdit) {
      return {
        text: "What would you like to change? (e.g., 'Make it 2 boxes', 'Change size to Large', or 'Restart')"
      };
    }
  }

  if (isLockedCheckoutState(state) && state !== "confirmed") {
    return buildCheckoutReply(state, order);
  }

  if (canTriggerGreeting && parsed.isGreeting) {
    return buildWelcomeReply();
  }

  if (canTriggerGreeting && isPriceMessage(rawMessage)) {
    return buildPricingReply();
  }

  if (state === "confirmed") {
    return buildConfirmedReply();
  }

  if (parsed.productSize || isExactSizeMessage(rawMessage)) {
    return buildCheckoutReply("awaiting_quantity", order);
  }

  if (parsed.intent === "delivery") {
    return "We deliver across Mumbai and Thane. Would you like pricing first or are you ready to place an order?";
  }

  if (parsed.intent === "quality_trust") {
    return "Every mango is hand-checked, GI tagged, and naturally ripened without carbide. Would you like pricing first or are you ready to place an order?";
  }

  if (parsed.intent === "gift") {
    return "For gifting, Jumbo is our premium pick. Would you like to reserve one or more boxes?";
  }

  if (parsed.intent === "corporate") {
    return "We handle corporate mango gifting as well. Share the quantity and delivery area, and I will guide you through the order.";
  }

  if (parsed.intent === "subscription") {
    return "We can help with repeat seasonal orders too. Tell me the box size you want to start with.";
  }

  if (parsed.intent === "visit_store") {
    return "You can visit us at 1st Floor, The Walk, Hiranandani Estate, Thane. Would you like pricing first or would you like to place an order?";
  }

  if (parsed.quantity && !parsed.productSize && !order?.product_size) {
    return "Which size would you like? Medium, Large, or Jumbo?";
  }

  return null;
}

export function getCheckoutFallback(state: SalesState): string {
  switch (state) {
    case "awaiting_quantity": return "How many boxes would you like? (e.g., '2 boxes')";
    case "awaiting_name": return "I'll need your name to continue the order. What's your name?";
    case "awaiting_address": return "Could you please share the delivery address?";
    case "awaiting_date": return "When should we deliver these mangoes?";
    case "awaiting_confirmation": return "Please confirm the order above so I can send it to the team.";
    default: return "I'm sorry, I didn't catch that. Could you please provide the details for your order?";
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
    name
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

  let query = supabase
    .from("conversations")
    .update(patch)
    .eq("id", conversationId);

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
