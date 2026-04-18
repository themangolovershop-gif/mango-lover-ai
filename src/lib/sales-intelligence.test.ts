import { describe, expect, it } from "vitest";
import { analyzeCustomerMessage, normalizeInboundText } from "@/lib/sales-intelligence";

describe("sales intelligence", () => {
  it("normalizes common buyer typos without losing intent", () => {
    expect(normalizeInboundText("mumbai delivry kal?")).toBe("mumbai delivery kal");
  });

  it("extracts premium product selection from messy short text", () => {
    const analysis = analyzeCustomerMessage({ rawText: "2 dazan jumbo" });

    expect(analysis.entities.productSize).toBe("jumbo");
    expect(analysis.entities.quantity?.value).toBe(2);
    expect(analysis.intents).toEqual(
      expect.arrayContaining(["product_selection", "order_start"])
    );
  });

  it("detects gifting and recommendation from Hinglish phrasing", () => {
    const analysis = analyzeCustomerMessage({ rawText: "gift ke liye best" });

    expect(analysis.intents).toEqual(
      expect.arrayContaining(["gifting", "recommendation_request"])
    );
    expect(analysis.primaryIntent).toBe("recommendation_request");
  });

  it("detects payment submissions from shorthand buyer messages", () => {
    const analysis = analyzeCustomerMessage({ rawText: "payment done chk" });

    expect(analysis.primaryIntent).toBe("payment_update");
    expect(analysis.entities.paymentStatus).toBe("submitted");
    expect(analysis.leadStage).toBe("payment_submitted");
  });

  it("flags large corporate requirements for auto handoff", () => {
    const analysis = analyzeCustomerMessage({ rawText: "50 dozen corp req" });

    expect(analysis.intents).toEqual(
      expect.arrayContaining(["corporate_order", "bulk_order"])
    );
    expect(analysis.escalation.recommended).toBe(true);
    expect(analysis.escalation.autoHandoff).toBe(true);
  });

  it("parses dense Indian address style messages", () => {
    const analysis = analyzeCustomerMessage({
      rawText:
        "Raj javeri sagar mahal apartment walkeshwar malabar hill mumbai 400006 2 dozen large paid",
    });

    expect(analysis.entities.address?.city).toBe("mumbai");
    expect(analysis.entities.address?.pinCode).toBe("400006");
    expect(analysis.entities.productSize).toBe("large");
    expect(analysis.entities.quantity?.value).toBe(2);
    expect(analysis.entities.paymentMentioned).toBe(true);
  });
});
