export type IntentType = 
  | 'greeting'
  | 'pricing'
  | 'product_selection'
  | 'recommendation_request'
  | 'quality_check'
  | 'authenticity_check'
  | 'delivery_check'
  | 'availability_check'
  | 'order_start'
  | 'address_submission'
  | 'payment_update'
  | 'discount_request'
  | 'objection_price'
  | 'gifting'
  | 'bulk_order'
  | 'repeat_order'
  | 'complaint'
  | 'refund'
  | 'cancellation'
  | 'order_summary_request'
  | 'edit_order_request'
  | 'restart_order_request'
  | 'reset_conversation'
  | 'gratitude'
  | 'human_help_request'
  | 'out_of_scope'
  | 'unknown';

export interface DetectedIntentResult {
  primaryIntent: IntentType;
  secondaryIntents: IntentType[];
  confidence: number;
}

const INTENT_KEYWORDS: Record<IntentType, string[]> = {
  greeting: ['hi', 'hello', 'hey', 'namaste', 'good morning', 'good afternoon', 'good evening'],
  pricing: ['price', 'rate', 'coast', 'cost', 'how much', 'kitna', 'bhav', 'menu'],
  product_selection: ['want', 'buy', 'need', 'ordering', 'selection'],
  recommendation_request: ['which', 'best', 'recommend', 'suggestion', 'difference'],
  quality_check: ['quality', 'fresh', 'ripened', 'ripening', 'organic', 'carbide', 'natural', 'sweet', 'storage', 'store'],
  authenticity_check: ['original', 'real', 'authenticity', 'gi tag', 'gi-tagged', 'devgad', 'ratnagiri'],
  delivery_check: ['delivery', 'reach', 'courier', 'shipping', 'when'],
  availability_check: ['stock', 'available', 'have', 'milage', 'milinga'],
  order_start: ['book', 'place', 'start', 'confirm', 'order'],
  address_submission: ['address', 'residence', 'landmark', 'pincode', 'area', 'city'],
  payment_update: ['paid', 'payment', 'transfer', 'done', 'screenshot', 'reference'],
  discount_request: ['discount', 'offer', 'code', 'less', 'coupon'],
  objection_price: ['expensive', 'high', 'too much', 'cheap', 'costly'],
  gifting: ['gift', 'send to', 'surprise', 'birthday', 'anniversary'],
  bulk_order: ['bulk', 'boxes', 'large quantity', 'wholesale', 'big order'],
  repeat_order: ['again', 'repeat', 'last time', 'previous', 'as before', 'same as previous', 'same as last time', 'last order'],
  complaint: ['bad', 'rotten', 'spoiled', 'wrong', 'issue', 'problem'],
  refund: ['refund', 'money back', 'return', 'cancel'],
  cancellation: ['cancel', 'don\'t want', 'stop'],
  order_summary_request: [
    'what did i order',
    'show details',
    'show order',
    'order details',
    'what is my order',
    'my order',
    'show summary',
  ],
  edit_order_request: [
    'change order',
    'edit order',
    'edit',
    'different quantity',
    'wrong address',
    'change quantity',
    'change address',
    'modify',
    'wrong qty',
    'wrong pincode',
  ],
  restart_order_request: ['start again', 'reset', 'restart', 'start fresh', 'begin again'],
  reset_conversation: ['clear my data', 'forget me', 'forget everything', 'delete my details', 'start from zero'],
  gratitude: ['thanks', 'thank you', 'ok', 'got it', 'nice'],
  human_help_request: ['human', 'person', 'talk to', 'agent', 'support'],
  out_of_scope: ['weather', 'news', 'joke', 'random'],
  unknown: []
};

/**
 * Detects customer intents from normalized text using a rule-based keyword matcher.
 * This is designed to be the first pass before potentially calling an AI model.
 */
export const detectIntents = (text: string): DetectedIntentResult => {
  const normalizedText = text.toLowerCase();
  const matchedIntents: { type: IntentType; score: number }[] = [];

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    if (intent === 'unknown') continue;
    
    let score = 0;
    keywords.forEach(keyword => {
      if (normalizedText.includes(keyword)) {
        score += 1;
      }
    });

    if (score > 0) {
      matchedIntents.push({ type: intent as IntentType, score });
    }
  }

  // Sort by score
  matchedIntents.sort((a, b) => b.score - a.score);

  if (matchedIntents.length === 0) {
    return {
      primaryIntent: 'unknown',
      secondaryIntents: [],
      confidence: 0,
    };
  }

  return {
    primaryIntent: matchedIntents[0].type,
    secondaryIntents: matchedIntents.slice(1).map(i => i.type),
    confidence: Math.min(matchedIntents[0].score * 0.4, 0.95), // Heuristic confidence
  };
};
