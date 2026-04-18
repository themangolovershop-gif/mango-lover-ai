import { LeadIntelligence, SalesOpportunity, EngineResult } from "./types";

export class ReorderEngine {
  process(intel: LeadIntelligence, lastOrderDetails?: any): EngineResult {
    const opportunities: SalesOpportunity[] = [];

    // Logic: If they are a repeat buyer or had a successful order 15-25 days ago
    if (intel.lastInteractionDays >= 15 && intel.lastInteractionDays <= 25) {
      opportunities.push({
        actionType: "SEND_REORDER_NUDGE",
        priority: 2,
        reason: "Time for seasonal reorder (approx 20 days since last batch).",
        metadata: { 
          style: "personalized",
          lastProduct: lastOrderDetails?.productSize 
        }
      });
    }

    return { opportunities };
  }
}
