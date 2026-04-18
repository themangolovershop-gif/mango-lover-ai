import { LeadIntelligence, SalesOpportunity, EngineResult } from "./types";

export class FollowUpEngine {
  process(intel: LeadIntelligence): EngineResult {
    const opportunities: SalesOpportunity[] = [];

    // Rule 1: Awaiting Payment for > 24 hours
    if (intel.stage === "AWAITING_PAYMENT" && intel.lastInteractionDays >= 1) {
      opportunities.push({
        actionType: "SEND_PAYMENT_REMINDER",
        priority: 1,
        reason: "Lead stuck at payment for > 24 hours.",
        metadata: { style: "action-oriented" }
      });
    }

    // Rule 2: Qualified lead goes cold for > 2 days
    if (intel.stage === "QUALIFIED" && intel.lastInteractionDays >= 2) {
      opportunities.push({
        actionType: "SEND_FOLLOWUP",
        priority: 2,
        reason: "Qualified lead inactive for 48 hours.",
        metadata: { style: "helpful-recommendation" }
      });
    }

    // Rule 3: New Inquiry but no response for > 3 days
    if (intel.stage === "NEW_INQUIRY" && intel.lastInteractionDays >= 3) {
      opportunities.push({
        actionType: "MARK_COLD",
        priority: 4,
        reason: "New inquiry never engaged after 72 hours."
      });
    }

    return { opportunities };
  }
}
