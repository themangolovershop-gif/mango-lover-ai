import { IntentType } from '../ai/intent.service';
import { ExtractedEntities } from '../ai/entity.service';

export type BuyerType = 'PERSONAL' | 'GIFTING' | 'BULK' | 'REPEAT' | 'UNCERTAIN';

interface BuyerTypeParams {
  intents: IntentType[];
  entities: ExtractedEntities;
  isRepeatBuyer: boolean;
}

/**
 * Detects the type of buyer based on behavioral signals.
 */
export const detectBuyerType = (params: BuyerTypeParams): BuyerType => {
  const { intents, entities, isRepeatBuyer } = params;

  if (isRepeatBuyer) return 'REPEAT';

  if (intents.includes('bulk_order') || (entities.quantityDozen && entities.quantityDozen >= 10)) {
    return 'BULK';
  }

  if (intents.includes('gifting') || entities.gifting) {
    return 'GIFTING';
  }

  if (intents.includes('order_start') || intents.includes('pricing') || entities.quantityDozen) {
    return 'PERSONAL';
  }

  return 'UNCERTAIN';
};
