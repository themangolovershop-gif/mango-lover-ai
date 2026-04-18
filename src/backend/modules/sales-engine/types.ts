import { LeadStage, LeadTemperature, BuyerType, SalesActionType } from "@prisma/client";

export interface LeadIntelligence {
  leadScore: number;
  temperature: LeadTemperature;
  buyerType: BuyerType;
  stage: LeadStage;
  quantityValue: number;
  lastInteractionDays: number;
  vipScore: number;
}

export interface SalesOpportunity {
  actionType: SalesActionType;
  priority: number; // 1 (High) to 5 (Low)
  reason: string;
  metadata?: any;
}

export interface EngineResult {
  opportunities: SalesOpportunity[];
}
