import type { LeadStage as PrismaLeadStage } from '@prisma/client';

import { IntentType } from '../ai/intent.service';
import { ExtractedEntities } from '../ai/entity.service';

export type LeadStage =
  | 'NEW_INQUIRY'
  | 'ENGAGED'
  | 'QUALIFIED'
  | 'AWAITING_DETAILS'
  | 'AWAITING_PAYMENT'
  | 'PAYMENT_SUBMITTED'
  | 'CONFIRMED'
  | 'COMPLAINT_OPEN'
  | 'ESCALATED'
  | 'COLD'
  | 'LOST';

interface StageParams {
  currentStage: LeadStage | null | undefined;
  intents: IntentType[];
  entities: ExtractedEntities;
  score: number;
  hasOrder: boolean;
  paymentStatus?: string;
}

export function mapPrismaLeadStageToDerived(stage: PrismaLeadStage | null | undefined): LeadStage {
  switch (stage) {
    case 'NEW':
      return 'NEW_INQUIRY';
    case 'BROWSING':
      return 'ENGAGED';
    case 'AWAITING_QUANTITY':
      return 'QUALIFIED';
    case 'AWAITING_ADDRESS':
    case 'AWAITING_DATE':
      return 'AWAITING_DETAILS';
    case 'AWAITING_CONFIRMATION':
      return 'AWAITING_PAYMENT';
    case 'CONFIRMED':
      return 'CONFIRMED';
    case 'HUMAN_HANDOFF':
      return 'ESCALATED';
    case 'LOST':
      return 'LOST';
    default:
      return 'NEW_INQUIRY';
  }
}

/**
 * Determines the next lead stage based on current state and new signals.
 */
export const determineLeadStage = (params: StageParams): LeadStage => {
  const { currentStage, intents, entities, score, hasOrder, paymentStatus } = params;

  // Escalation priority
  if (intents.includes('complaint')) return 'COMPLAINT_OPEN';
  if (intents.includes('refund') || intents.includes('human_help_request')) return 'ESCALATED';

  // State transitions
  if (paymentStatus === 'VERIFIED') return 'CONFIRMED';
  if (paymentStatus === 'SUBMITTED') return 'PAYMENT_SUBMITTED';

  if (hasOrder) {
    if (paymentStatus === 'UNPAID') return 'AWAITING_PAYMENT';
    return 'QUALIFIED';
  }

  if (entities.addressText || (entities.city && entities.pinCode)) {
    return 'AWAITING_DETAILS';
  }

  if (entities.quantityDozen || entities.size || entities.city) {
    return 'QUALIFIED';
  }

  if (score > 30 || intents.includes('pricing') || intents.includes('product_selection')) {
    return 'ENGAGED';
  }

  // Fallback to current if no significant signals
  return currentStage ?? 'NEW_INQUIRY';
};
