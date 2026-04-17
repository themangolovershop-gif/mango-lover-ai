import type {
  Conversation,
  Order,
  ProductSize,
  SalesState,
} from "@/lib/types";

const LOCKED_CHECKOUT_STATES: SalesState[] = [
  "awaiting_quantity",
  "awaiting_name",
  "awaiting_address",
  "awaiting_date",
  "awaiting_confirmation",
];

type OrderValueInput =
  | Pick<Order, "product_size" | "quantity" | "notes">
  | null
  | undefined;

export type SalesStateReconciliation = {
  matches: boolean;
  expected: SalesState;
  actual: SalesState;
};

function hasUpsellDiscount(notes: string | null | undefined) {
  return notes?.toLowerCase().includes("upsell accepted") ?? false;
}

export function normalizeSalesStateValue(state: string | null | undefined): SalesState {
  if (state === "recommended") return "browsing";
  if (state === "awaiting_location") return "awaiting_address";
  if (state === "awaiting_delivery_date") return "awaiting_date";

  switch (state) {
    case "new":
    case "browsing":
    case "awaiting_quantity":
    case "awaiting_name":
    case "awaiting_address":
    case "awaiting_date":
    case "awaiting_confirmation":
    case "confirmed":
    case "human_handoff":
    case "lost":
      return state;
    default:
      return "new";
  }
}

export function isLockedCheckoutState(state: SalesState): boolean {
  return LOCKED_CHECKOUT_STATES.includes(state);
}

export function sizeLabel(size: ProductSize): string {
  switch (size) {
    case "medium":
      return "Medium";
    case "large":
      return "Large";
    case "jumbo":
      return "Jumbo";
  }
}

export function sizePrice(size: ProductSize): number {
  switch (size) {
    case "medium":
      return 1499;
    case "large":
      return 1999;
    case "jumbo":
      return 2499;
  }
}

export function calculateOrderValue(order: OrderValueInput) {
  if (!order?.product_size || !order.quantity) return 0;

  let total = sizePrice(order.product_size) * order.quantity;

  if (hasUpsellDiscount(order.notes)) {
    total -= 200;
  }

  return Math.max(total, 0);
}

export function nextCheckoutStateFromOrder(order: Order | null): SalesState {
  if (!order) return "browsing";
  if (order.status === "cancelled") return "lost";
  if (order.status === "confirmed") return "confirmed";
  if (!order.product_size) return "browsing";
  if (!order.quantity) return "awaiting_quantity";
  if (!order.customer_name) return "awaiting_name";
  if (!order.delivery_address) return "awaiting_address";
  if (!order.delivery_date) return "awaiting_date";
  return "awaiting_confirmation";
}

export function reconcileSalesState(
  conversation: Pick<Conversation, "sales_state" | "mode">,
  latestOrder: Order | null
): SalesStateReconciliation {
  const actual = normalizeSalesStateValue(conversation.sales_state);

  if (conversation.mode === "human" || actual === "human_handoff") {
    return { matches: true, expected: actual, actual };
  }

  if (!latestOrder) {
    return { matches: true, expected: actual, actual };
  }

  const expected = nextCheckoutStateFromOrder(latestOrder);

  return {
    matches: actual === expected,
    expected,
    actual,
  };
}
