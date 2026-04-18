import { IntentType } from '../ai/intent.service';
import { ExtractedEntities } from '../ai/entity.service';

/**
 * Calculates a lead score based on detected intents and extracted entities.
 * Score range: 0-100
 */
export const calculateLeadScore = (
  intents: IntentType[], 
  entities: ExtractedEntities
): number => {
  let score = 0;

  // Intent-based scoring
  if (intents.includes('pricing')) score += 10;
  if (intents.includes('quality_check')) score += 15;
  if (intents.includes('delivery_check')) score += 15;
  if (intents.includes('order_start')) score += 50;
  if (intents.includes('bulk_order')) score += 60;
  if (intents.includes('complaint')) score -= 20;

  // Entity-based scoring
  if (entities.city) score += 20;
  if (entities.quantityDozen) score += 25;
  if (entities.pinCode || entities.addressText) score += 40;
  if (entities.paymentMentioned) score += 80;

  // Clamp score
  return Math.max(0, Math.min(100, score));
};

/**
 * Determines lead temperature based on score.
 */
export const getLeadTemperature = (score: number): 'COLD' | 'WARM' | 'HOT' => {
  if (score >= 70) return 'HOT';
  if (score >= 30) return 'WARM';
  return 'COLD';
};
