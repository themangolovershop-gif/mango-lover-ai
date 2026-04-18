import { LeadIntelligence, SalesOpportunity } from "./types";

export class PriorityEngine {
  calculateScore(intel: LeadIntelligence): number {
    // priorityScore = leadScore * 0.35 + quantityScore * 0.20 + recencyScore * 0.15 + vipScore * 0.15 + stateScore * 0.15
    
    const quantityScore = Math.min(intel.quantityValue * 10, 100);
    const recencyScore = Math.max(0, 100 - (intel.lastInteractionDays * 10));
    const vipScore = intel.vipScore;
    
    // Higher score for stages close to conversion
    const stageWeight: Record<string, number> = {
      "AWAITING_PAYMENT": 100,
      "AWAITING_DETAILS": 80,
      "QUALIFIED": 60,
      "ENGAGED": 40,
      "NEW_INQUIRY": 20
    };
    
    const stateScore = stageWeight[intel.stage] || 0;

    return (
      intel.leadScore * 0.35 +
      quantityScore * 0.20 +
      recencyScore * 0.15 +
      vipScore * 0.15 +
      stateScore * 0.15
    );
  }

  getPriorityLevel(score: number): number {
    if (score > 80) return 1; // P1: Hot
    if (score > 50) return 2; // P2: Warm
    if (score > 20) return 3; // P3: Nurture
    return 4; // P4: Low Priority
  }
}
