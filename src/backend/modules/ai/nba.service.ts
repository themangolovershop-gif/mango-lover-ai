import { IntentType } from './intent.service';
import { ExtractedEntities } from './entity.service';
import { LeadStage } from '../leads/stage.service';

export type NextAction = 
  | 'EDUCATE'
  | 'COLLECT_QUANTITY_AND_CITY'
  | 'RECOMMEND_PRODUCT'
  | 'COLLECT_ADDRESS'
  | 'REQUEST_PAYMENT'
  | 'CONFIRM_ORDER'
  | 'ESCALATE_HUMAN'
  | 'HANDLE_COMPLAINT'
  | 'GREET';

interface NBAParams {
  leadStage: LeadStage;
  intents: IntentType[];
  entities: ExtractedEntities;
  hasOrder: boolean;
  paymentStatus?: string;
}

/**
 * Decides the next best action to take in the conversation.
 */
export const decideNextAction = (params: NBAParams): NextAction => {
  const { leadStage, intents, entities, hasOrder, paymentStatus } = params;
  const hasEducationIntent =
    intents.includes('pricing') ||
    intents.includes('quality_check') ||
    intents.includes('authenticity_check') ||
    intents.includes('delivery_check') ||
    intents.includes('availability_check');
  const hasRecommendationIntent =
    intents.includes('recommendation_request') || intents.includes('gifting');
  const wantsRestart =
    intents.includes('restart_order_request') || intents.includes('cancellation');
  const wantsOrderSupport =
    intents.includes('order_summary_request') || intents.includes('edit_order_request');

  // 1. Critical overrides
  if (intents.includes('complaint')) return 'HANDLE_COMPLAINT';
  if (intents.includes('human_help_request') || intents.includes('refund')) return 'ESCALATE_HUMAN';
  if (wantsRestart) return 'COLLECT_QUANTITY_AND_CITY';
  if (wantsOrderSupport) return 'EDUCATE';

  // 2. Stage-based decisions
  switch (leadStage) {
    case 'NEW_INQUIRY':
      if (intents.includes('greeting')) return 'GREET';
      if (hasEducationIntent) return 'EDUCATE';
      if (hasRecommendationIntent) return 'RECOMMEND_PRODUCT';
      return 'COLLECT_QUANTITY_AND_CITY';

    case 'ENGAGED':
      if (hasEducationIntent) return 'EDUCATE';
      if (hasRecommendationIntent) return 'RECOMMEND_PRODUCT';
      if (!entities.quantityDozen || !entities.city) return 'COLLECT_QUANTITY_AND_CITY';
      return 'RECOMMEND_PRODUCT';

    case 'QUALIFIED':
      if (hasEducationIntent) return 'EDUCATE';
      if (hasRecommendationIntent) return 'RECOMMEND_PRODUCT';
      if (!hasOrder) return 'RECOMMEND_PRODUCT';
      return 'COLLECT_ADDRESS';

    case 'AWAITING_DETAILS':
      if (hasEducationIntent || hasRecommendationIntent) return 'EDUCATE';
      if (!entities.addressText) return 'COLLECT_ADDRESS';
      return 'REQUEST_PAYMENT';

    case 'AWAITING_PAYMENT':
      if (hasEducationIntent || hasRecommendationIntent) return 'EDUCATE';
      if (paymentStatus === 'SUBMITTED') return 'CONFIRM_ORDER';
      return 'REQUEST_PAYMENT';

    case 'PAYMENT_SUBMITTED':
      if (hasEducationIntent || hasRecommendationIntent) return 'EDUCATE';
      return 'CONFIRM_ORDER';

    default:
      if (intents.includes('pricing')) return 'EDUCATE';
      if (intents.includes('authenticity_check') || intents.includes('quality_check')) return 'EDUCATE';
      return 'EDUCATE';
  }
};
