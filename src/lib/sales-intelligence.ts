import type { Order, ProductSize, SalesState } from "@/lib/types";
import { DEFAULT_SALES_SETTINGS, estimateCatalogOrderValue } from "@/lib/sales-settings";
import type {
  BuyerType,
  CustomerEntities,
  CustomerMessageAnalysis,
  EscalationSeverity,
  EscalationType,
  LanguageStyle,
  LeadScoreFactor,
  LeadTemperature,
  QuantityEntity,
  QuantityUnit,
  SalesEscalationDecision,
  SalesIntent,
} from "@/lib/sales-platform-contracts";

const PRODUCT_ALIASES: Record<ProductSize, string[]> = {
  medium: ["medium", "med", "regular"],
  large: ["large", "lg"],
  jumbo: ["jumbo", "xl", "extra large", "big box"],
};

const TOKEN_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bdelivry\b/g, "delivery"],
  [/\bdelievery\b/g, "delivery"],
  [/\bdeliveryy\b/g, "delivery"],
  [/\baddr\b/g, "address"],
  [/\baddres\b/g, "address"],
  [/\badress\b/g, "address"],
  [/\bpymnt\b/g, "payment"],
  [/\bpaymnt\b/g, "payment"],
  [/\bpaymnet\b/g, "payment"],
  [/\bdazan\b/g, "dozen"],
  [/\bdozn\b/g, "dozen"],
  [/\bdzn\b/g, "dozen"],
  [/\bcorp\b/g, "corporate"],
  [/\breq\b/g, "requirement"],
  [/\bchk\b/g, "check"],
  [/\bmumbi\b/g, "mumbai"],
  [/\bmumabi\b/g, "mumbai"],
  [/\bcalcel\b/g, "cancel"],
];

const CITY_KEYWORDS = [
  "mumbai",
  "thane",
  "navi mumbai",
  "pune",
  "delhi",
  "gurgaon",
  "noida",
  "bengaluru",
  "bangalore",
  "hyderabad",
  "kolkata",
  "ahmedabad",
  "surat",
  "goa",
];

const STATE_KEYWORDS = [
  "maharashtra",
  "gujarat",
  "delhi",
  "karnataka",
  "telangana",
  "west bengal",
  "goa",
];

const ADDRESS_HINTS = [
  "address",
  "apartment",
  "flat",
  "floor",
  "tower",
  "building",
  "society",
  "road",
  "lane",
  "marg",
  "nagar",
  "hill",
  "sector",
  "colony",
  "near",
  "opp",
  "opposite",
  "landmark",
];

const NAME_STOPWORDS = new Set([
  "hi",
  "hello",
  "hey",
  "price",
  "rate",
  "delivery",
  "address",
  "confirm",
  "book",
  "gift",
  "corporate",
  "payment",
  "paid",
  "done",
  "thanks",
  "thank you",
  "large",
  "medium",
  "jumbo",
]);

const INTENT_KEYWORDS: Record<SalesIntent, string[]> = {
  greeting: ["hi", "hello", "hey", "namaste", "hii"],
  pricing: ["price", "rate", "cost", "kitna", "bhav", "pricing"],
  product_selection: ["medium", "large", "jumbo", "xl", "box", "boxes"],
  recommendation_request: ["recommend", "suggest", "best", "which one", "kon sa", "gift ke liye"],
  quality_check: ["natural", "sweet", "taste", "quality", "fresh"],
  authenticity_check: ["authentic", "original", "gi", "devgad", "carbide", "real"],
  delivery_check: ["delivery", "shipping", "ship", "mumbai", "thane", "tomorrow", "urgent", "today"],
  availability_check: ["available", "availability", "stock", "batch", "season", "slot"],
  order_start: ["book", "reserve", "order", "want", "need", "1 box", "2 box"],
  address_submission: ["address", "pincode", "pin", "apartment", "flat", "building", "tower"],
  payment_update: ["payment", "paid", "upi", "utr", "reference", "screenshot", "transaction"],
  order_confirmation_request: ["confirm", "final", "lock", "done order"],
  discount_request: ["discount", "offer", "best rate", "less price"],
  objection_price: ["expensive", "costly", "market me sasta", "cheaper", "sasta"],
  gifting: ["gift", "gifting", "hamper"],
  bulk_order: ["bulk", "wholesale", "dealer", "reseller", "50 dozen"],
  corporate_order: ["corporate", "office", "event", "clients", "team"],
  repeat_order: ["again", "repeat", "same as last", "last time", "once more"],
  complaint: ["complaint", "damaged", "bad", "spoiled", "issue", "rotten", "soft"],
  refund: ["refund", "return", "replace", "money back"],
  cancellation: ["cancel", "stop order", "don't send", "dont send", "calcel"],
  restart_order_request: ["start again", "reset", "restart", "start fresh", "begin again"],
  reset_conversation: ["clear my data", "forget me", "forget everything", "delete my details", "start from zero"],
  edit_order_request: ["change order", "edit order", "edit", "modify", "wrong quantity", "change address"],
  gratitude: ["thanks", "thank you", "thx", "tnx"],
  out_of_scope: ["weather", "news", "joke"],
  human_help_request: ["human", "person", "support", "manager", "call me", "team member"],
};

const PRIMARY_INTENT_PRIORITY: SalesIntent[] = [
  "human_help_request",
  "complaint",
  "refund",
  "reset_conversation",
  "restart_order_request",
  "cancellation",
  "payment_update",
  "corporate_order",
  "bulk_order",
  "edit_order_request",
  "order_confirmation_request",
  "address_submission",
  "order_start",
  "pricing",
  "recommendation_request",
  "delivery_check",
  "availability_check",
  "authenticity_check",
  "quality_check",
  "gifting",
  "repeat_order",
  "discount_request",
  "objection_price",
  "gratitude",
  "greeting",
  "product_selection",
  "out_of_scope",
];

function hasWord(text: string, phrase: string) {
  return new RegExp(`(^|\\b)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\b|$)`, "i").test(
    text
  );
}

function detectLanguageStyle(normalizedText: string): LanguageStyle {
  if (/\b(hai|kal|liye|bheju|kitna|bhai|bilkul|chahiye)\b/.test(normalizedText)) {
    return "hinglish";
  }

  if (/\b(pls|plz|snd|msg|deliv)\b/.test(normalizedText) || normalizedText.length <= 12) {
    return "broken_english";
  }

  return "english";
}

function extractProductSize(normalizedText: string) {
  for (const [size, aliases] of Object.entries(PRODUCT_ALIASES) as Array<
    [ProductSize, string[]]
  >) {
    if (aliases.some((alias) => hasWord(normalizedText, alias))) {
      return size;
    }
  }

  return null;
}

function normalizeQuantityUnit(rawUnit: string | undefined): QuantityUnit {
  if (!rawUnit) return "unknown";

  if (["box", "boxes"].includes(rawUnit)) return rawUnit as QuantityUnit;
  if (rawUnit === "dozen") return "dozen";
  if (rawUnit === "peti") return "peti";
  if (rawUnit === "crate" || rawUnit === "carton") return "crate";
  if (["unit", "units", "pc", "pcs"].includes(rawUnit)) return "unit";
  return "unknown";
}

function extractQuantityEntity(rawText: string, normalizedText: string): QuantityEntity | null {
  const matches = [
    ...normalizedText.matchAll(
      /(^|[^a-z0-9])(\d{1,3})\s*(box|boxes|dozen|peti|crate|carton|unit|units|pc|pcs)?(?=$|[^a-z0-9])/g
    ),
  ];

  if (matches.length === 0) return null;

  const [firstMatch] = matches;
  const value = Number(firstMatch[2]);

  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  const pinCode = rawText.match(/\b\d{6}\b/);
  if (pinCode && firstMatch[2] === pinCode[0]) {
    return null;
  }

  const unit = normalizeQuantityUnit(firstMatch[3]);
  const confidence = unit === "unknown" ? 0.78 : 0.92;

  return { value, unit, confidence };
}

function detectCity(normalizedText: string) {
  return CITY_KEYWORDS.find((city) => hasWord(normalizedText, city)) ?? null;
}

function detectState(normalizedText: string) {
  return STATE_KEYWORDS.find((state) => hasWord(normalizedText, state)) ?? null;
}

function extractAddressEntity(rawText: string, normalizedText: string) {
  const pinCodeMatch = rawText.match(/\b\d{6}\b/);
  const hasAddressHint = ADDRESS_HINTS.some((hint) => hasWord(normalizedText, hint));
  const city = detectCity(normalizedText);
  const state = detectState(normalizedText);

  if (!pinCodeMatch && !hasAddressHint && !city) {
    return null;
  }

  const confidence = pinCodeMatch ? 0.86 : hasAddressHint ? 0.72 : 0.58;
  const landmark = /\b(near|opp|opposite|landmark)\b/.test(normalizedText) ? rawText.trim() : null;

  return {
    raw: rawText.trim(),
    city,
    state,
    pinCode: pinCodeMatch?.[0] ?? null,
    landmark,
    confidence,
  };
}

function extractCustomerName(rawText: string, normalizedText: string) {
  const cleaned = rawText.trim().replace(/[!?,.]+$/g, "");

  if (!cleaned || cleaned.length < 2 || /\d/.test(cleaned)) return null;
  if (cleaned.split(/\s+/).length > 4) return null;
  if (NAME_STOPWORDS.has(normalizedText)) return null;
  if (INTENT_KEYWORDS.greeting.some((keyword) => hasWord(normalizedText, keyword))) return null;

  if (/^[a-z][a-z.'\-\s]+$/i.test(cleaned)) {
    return cleaned;
  }

  return null;
}

function detectIntents(normalizedText: string, entities: CustomerEntities) {
  const found = new Set<SalesIntent>();

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS) as Array<
    [SalesIntent, string[]]
  >) {
    if (keywords.some((keyword) => hasWord(normalizedText, keyword))) {
      found.add(intent);
    }
  }

  if (entities.productSize) found.add("product_selection");
  if (entities.quantity) found.add("order_start");
  if (entities.address) found.add("address_submission");
  if (entities.paymentMentioned) found.add("payment_update");
  if (entities.giftingIntent) found.add("gifting");
  if (entities.corporateIntent) found.add("corporate_order");
  if (entities.repeatIntent) found.add("repeat_order");

  if (found.size === 0) {
    found.add("out_of_scope");
  }

  return [...found];
}

function pickPrimaryIntent(intents: SalesIntent[]) {
  return PRIMARY_INTENT_PRIORITY.find((intent) => intents.includes(intent)) ?? "out_of_scope";
}

function buildLeadScore(args: {
  intents: SalesIntent[];
  entities: CustomerEntities;
  productSize: ProductSize | null;
}) {
  const factors: LeadScoreFactor[] = [];

  function push(label: string, weight: number, reason: string) {
    factors.push({ label, weight, reason });
  }

  const { intents, entities, productSize } = args;

  if (intents.includes("pricing")) {
    push("pricing_interest", 8, "Customer asked for pricing.");
  }

  if (intents.includes("recommendation_request")) {
    push("recommendation_request", 10, "Customer wants guided selection.");
  }

  if (entities.quantity) {
    push("quantity_shared", 14, "Customer shared a quantity.");
  }

  if (productSize) {
    push("size_shared", 10, "Customer signalled a preferred box.");
  }

  if (entities.city) {
    push("city_shared", 8, "Customer shared delivery geography.");
  }

  if (entities.address) {
    push("address_shared", 18, "Customer shared address-like details.");
  }

  if (intents.includes("payment_update")) {
    push("payment_signal", 24, "Customer referenced payment.");
  }

  if (intents.includes("repeat_order")) {
    push("repeat_signal", 14, "Customer appears to be a repeat buyer.");
  }

  if (intents.includes("corporate_order") || intents.includes("bulk_order")) {
    push("high_value_signal", 18, "Customer indicated a large requirement.");
  }

  if (intents.includes("complaint") || intents.includes("refund")) {
    push("support_case", -10, "Conversation became a service or recovery case.");
  }

  return factors;
}

function calculateScore(factors: LeadScoreFactor[]) {
  return Math.max(
    0,
    Math.min(
      100,
      factors.reduce((total, factor) => total + factor.weight, 0)
    )
  );
}

function inferTemperature(score: number): LeadTemperature {
  if (score >= 35) return "hot";
  if (score >= 15) return "warm";
  return "cold";
}

function inferBuyerType(intents: SalesIntent[], entities: CustomerEntities): BuyerType {
  if (intents.includes("corporate_order")) return "corporate";
  if (intents.includes("bulk_order")) return "wholesale";
  if (entities.giftingIntent) return "gifting";
  if (entities.repeatIntent) return "repeat";
  if (intents.includes("out_of_scope")) return "uncertain";
  return "personal";
}

function inferLeadStage(args: {
  intents: SalesIntent[];
  entities: CustomerEntities;
  escalation: SalesEscalationDecision;
  currentState?: SalesState | null;
}) {
  const { intents, entities, escalation, currentState } = args;

  if (intents.includes("complaint") || intents.includes("refund")) {
    return "complaint_open";
  }

  if (escalation.recommended && escalation.autoHandoff) {
    return "escalated";
  }

  if (intents.includes("payment_update")) {
    return "payment_submitted";
  }

  if (entities.repeatIntent) {
    return "repeat_customer";
  }

  if (entities.address || currentState === "awaiting_address") {
    return "awaiting_details";
  }

  if (entities.city && entities.quantity) {
    return "qualified";
  }

  if (intents.includes("recommendation_request") || intents.includes("gifting")) {
    return "product_recommended";
  }

  if (intents.includes("pricing") || intents.includes("delivery_check")) {
    return "engaged";
  }

  return "new_inquiry";
}

function buildEscalationDecision(args: {
  intents: SalesIntent[];
  entities: CustomerEntities;
  estimatedOrderValue: number;
  confidence: number;
}) {
  const { intents, entities, estimatedOrderValue, confidence } = args;

  const corporateOrBulk =
    intents.includes("corporate_order") || intents.includes("bulk_order");
  const quantity = entities.quantity?.value ?? 0;
  const confidenceFloor = DEFAULT_SALES_SETTINGS.thresholds.autoHandoffConfidenceFloor;

  const result: SalesEscalationDecision = {
    recommended: false,
    type: null,
    severity: null,
    reason: null,
    autoHandoff: false,
  };

  function assign(
    type: EscalationType,
    severity: EscalationSeverity,
    reason: string,
    autoHandoff: boolean
  ) {
    result.recommended = true;
    result.type = type;
    result.severity = severity;
    result.reason = reason;
    result.autoHandoff = autoHandoff;
  }

  if (intents.includes("human_help_request")) {
    assign("human_request", "medium", "Customer explicitly asked for a human.", true);
    return result;
  }

  if (intents.includes("complaint")) {
    assign("complaint", "high", "Complaint handling should move to a human owner.", true);
    return result;
  }

  if (intents.includes("refund")) {
    assign("refund", "high", "Refund or replacement case needs manual review.", true);
    return result;
  }

  if (corporateOrBulk && quantity >= DEFAULT_SALES_SETTINGS.thresholds.corporateQuantity) {
    assign(
      intents.includes("corporate_order") ? "corporate_order" : "bulk_order",
      "high",
      "Large requirement should be quoted manually.",
      true
    );
    return result;
  }

  if (
    intents.includes("bulk_order") &&
    quantity >= DEFAULT_SALES_SETTINGS.thresholds.bulkQuantity
  ) {
    assign("bulk_order", "medium", "Large quantity inquiry should be reviewed.", true);
    return result;
  }

  if (estimatedOrderValue >= DEFAULT_SALES_SETTINGS.thresholds.vipOrderValue) {
    assign("vip_order", "medium", "High-value order should be handled carefully.", false);
    return result;
  }

  if (confidence < confidenceFloor) {
    assign("low_confidence", "medium", "Low-confidence interpretation needs review.", false);
    return result;
  }

  return result;
}

function buildEntities(rawText: string, normalizedText: string): CustomerEntities {
  const quantity = extractQuantityEntity(rawText, normalizedText);
  const productSize = extractProductSize(normalizedText);
  const address = extractAddressEntity(rawText, normalizedText);
  const city = address?.city ?? detectCity(normalizedText);
  const state = address?.state ?? detectState(normalizedText);
  const pinCode = address?.pinCode ?? rawText.match(/\b\d{6}\b/)?.[0] ?? null;
  const giftingIntent = hasWord(normalizedText, "gift") || hasWord(normalizedText, "gifting");
  const corporateIntent =
    hasWord(normalizedText, "corporate") ||
    hasWord(normalizedText, "office") ||
    hasWord(normalizedText, "event");
  const repeatIntent =
    hasWord(normalizedText, "repeat") ||
    hasWord(normalizedText, "again") ||
    normalizedText.includes("last time");
  const paymentMentioned =
    hasWord(normalizedText, "payment") ||
    hasWord(normalizedText, "paid") ||
    hasWord(normalizedText, "utr") ||
    hasWord(normalizedText, "reference");

  let complaintType: string | null = null;
  if (hasWord(normalizedText, "damaged") || hasWord(normalizedText, "rotten")) {
    complaintType = "damage";
  } else if (hasWord(normalizedText, "refund")) {
    complaintType = "refund";
  } else if (hasWord(normalizedText, "quality")) {
    complaintType = "quality";
  }

  return {
    customerName: extractCustomerName(rawText, normalizedText),
    productSize,
    quantity,
    city,
    state,
    pinCode,
    address,
    giftingIntent,
    corporateIntent,
    repeatIntent,
    urgency: /(\btomorrow\b|\bkal\b)/.test(normalizedText)
      ? "tomorrow"
      : /(\burgent\b|\btoday\b|\basap\b)/.test(normalizedText)
        ? "urgent"
        : "normal",
    paymentMentioned,
    paymentStatus: paymentMentioned ? "submitted" : "unknown",
    complaintType,
  };
}

export function normalizeInboundText(input: string) {
  let normalized = input.trim().toLowerCase();
  normalized = normalized.replace(/[\u2018\u2019]/g, "'");
  normalized = normalized.replace(/[^a-z0-9\s,'./-]/g, " ");

  for (const [pattern, replacement] of TOKEN_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized.replace(/\s+/g, " ").trim();
}

export function analyzeCustomerMessage(args: {
  rawText: string;
  currentState?: SalesState | null;
  order?: Pick<Order, "product_size" | "quantity"> | null;
}): CustomerMessageAnalysis {
  const normalizedText = normalizeInboundText(args.rawText);
  const entities = buildEntities(args.rawText, normalizedText);
  const intents = detectIntents(normalizedText, entities);
  const primaryIntent = pickPrimaryIntent(intents);
  const estimatedOrderValue = estimateCatalogOrderValue(
    entities.productSize ?? args.order?.product_size ?? null,
    entities.quantity?.value ?? args.order?.quantity ?? null
  );
  const scoreBreakdown = buildLeadScore({
    intents,
    entities,
    productSize: entities.productSize,
  });
  const score = calculateScore(scoreBreakdown);
  const baseConfidence = Math.min(
    0.96,
    0.46 +
      Math.min(intents.length, 3) * 0.09 +
      (entities.productSize ? 0.1 : 0) +
      (entities.quantity ? 0.1 : 0) +
      (entities.address ? 0.12 : 0)
  );
  const confidence = Number(baseConfidence.toFixed(2));
  const escalation = buildEscalationDecision({
    intents,
    entities,
    estimatedOrderValue,
    confidence,
  });
  const buyerType = inferBuyerType(intents, entities);
  const temperature = inferTemperature(score);
  const leadStage = inferLeadStage({
    intents,
    entities,
    escalation,
    currentState: args.currentState,
  });

  return {
    rawText: args.rawText,
    normalizedText,
    intents,
    primaryIntent,
    languageStyle: detectLanguageStyle(normalizedText),
    entities,
    leadStage,
    buyerType,
    temperature,
    score,
    scoreBreakdown,
    escalation,
    confidence,
  };
}
