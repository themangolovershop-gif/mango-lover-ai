import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {}
}));
import {
  calculateOrderValue,
  getDeterministicTransition,
  nextCheckoutStateFromOrder,
  parseSalesInput,
  reconcileSalesState,
} from "./sales";
import type { Conversation, Order } from "./types";

const MOCK_CONV: Conversation = {
  id: "conv-123",
  phone: "919000000000",
  name: null,
  mode: "agent",
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  sales_state: "new",
  lead_tag: null,
  last_customer_intent: null,
};

describe("Sales State Machine", () => {
  it("should handle greeting in new state", () => {
    const rawMessage = "Hi";
    const parsed = parseSalesInput(rawMessage);
    const transition = getDeterministicTransition({
      conversation: MOCK_CONV,
      parsed,
      order: null,
      rawMessage,
    });

    expect(transition.handled).toBe(true);
    expect(transition.nextState).toBe("browsing");
    expect(transition.lastCustomerIntent).toBe("confused"); // 'hi' is confused intent but handled as greeting
  });

  it("should handle price inquiry", () => {
    const rawMessage = "what is the price?";
    const parsed = parseSalesInput(rawMessage);
    const transition = getDeterministicTransition({
      conversation: { ...MOCK_CONV, sales_state: "browsing" },
      parsed,
      order: null,
      rawMessage,
    });

    expect(transition.handled).toBe(true);
    expect(transition.nextState).toBe("browsing");
    expect(transition.lastCustomerIntent).toBe("price");
  });

  it("should transition to awaiting_quantity when size is provided", () => {
    const rawMessage = "I want Jumbo boxes";
    const parsed = parseSalesInput(rawMessage);
    const transition = getDeterministicTransition({
      conversation: { ...MOCK_CONV, sales_state: "browsing" },
      parsed,
      order: null,
      rawMessage,
    });

    expect(transition.handled).toBe(true);
    expect(transition.nextState).toBe("awaiting_quantity");
    expect(transition.orderPatch?.product_size).toBe("jumbo");
  });

  it("should transition to awaiting_name when size and quantity are provided", () => {
    const rawMessage = "Large 2 boxes";
    const parsed = parseSalesInput(rawMessage);
    const transition = getDeterministicTransition({
      conversation: { ...MOCK_CONV, sales_state: "browsing" },
      parsed,
      order: null,
      rawMessage,
    });

    expect(transition.handled).toBe(true);
    expect(transition.nextState).toBe("awaiting_name");
    expect(transition.orderPatch?.product_size).toBe("large");
    expect(transition.orderPatch?.quantity).toBe(2);
  });

  it("should capture name in awaiting_name state", () => {
    const rawMessage = "John Doe";
    const parsed = parseSalesInput(rawMessage);
    const mockOrder: Order = {
      id: "ord-1",
      conversation_id: "conv-123",
      customer_name: null,
      phone: "919000000000",
      product_size: "large",
      quantity: 2,
      delivery_address: null,
      delivery_date: null,
      status: "draft",
      order_type: "personal",
      notes: null,
      created_at: "",
      updated_at: "",
    };

    const transition = getDeterministicTransition({
      conversation: { ...MOCK_CONV, sales_state: "awaiting_name" },
      parsed,
      order: mockOrder,
      rawMessage,
    });

    expect(transition.handled).toBe(true);
    expect(transition.nextState).toBe("awaiting_address");
    expect(transition.orderPatch?.customer_name).toBe("John Doe");
  });

  it("should handle human handoff request", () => {
    const rawMessage = "I want to talk to a person";
    const parsed = parseSalesInput(rawMessage);
    const transition = getDeterministicTransition({
      conversation: { ...MOCK_CONV, sales_state: "browsing" },
      parsed,
      order: null,
      rawMessage,
    });

    expect(transition.handled).toBe(true);
    expect(transition.nextState).toBe("human_handoff");
    expect(transition.leadTag).toBe("human_required");
  });
});

describe("Sales Analytics Helpers", () => {
  it("calculates order value with upsell discount applied once", () => {
    expect(
      calculateOrderValue({
        product_size: "large",
        quantity: 2,
        notes: "Upsell Accepted: ₹200 discount",
      })
    ).toBe(3798);
  });

  it("derives lost state from a cancelled latest order", () => {
    const order: Order = {
      id: "ord-cancelled",
      conversation_id: "conv-123",
      customer_name: "John",
      phone: "919000000000",
      product_size: "jumbo",
      quantity: 1,
      delivery_address: "Thane",
      delivery_date: "Tomorrow",
      status: "cancelled",
      order_type: "personal",
      notes: null,
      created_at: "",
      updated_at: "",
    };

    expect(nextCheckoutStateFromOrder(order)).toBe("lost");
  });

  it("flags mismatches between conversation state and latest order state", () => {
    const order: Order = {
      id: "ord-confirmed",
      conversation_id: "conv-123",
      customer_name: "John",
      phone: "919000000000",
      product_size: "large",
      quantity: 1,
      delivery_address: "Thane",
      delivery_date: "Tomorrow",
      status: "confirmed",
      order_type: "personal",
      notes: null,
      created_at: "",
      updated_at: "",
    };

    expect(
      reconcileSalesState(
        {
          sales_state: "awaiting_confirmation",
          mode: "agent",
        },
        order
      )
    ).toEqual({
      matches: false,
      expected: "confirmed",
      actual: "awaiting_confirmation",
    });
  });
});
