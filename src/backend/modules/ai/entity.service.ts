export interface ExtractedEntities {
  quantityDozen?: number;
  size?: 'medium' | 'large' | 'jumbo';
  city?: string;
  pinCode?: string;
  addressText?: string;
  customerName?: string;
  phone?: string;
  paymentMentioned?: boolean;
  urgency?: boolean;
  gifting?: boolean;
}

/**
 * Extracts structured entities from normalized text using regex and heuristics.
 */
export const extractEntities = (text: string): ExtractedEntities => {
  const entities: ExtractedEntities = {};
  const normalized = text.toLowerCase();

  // 1. Quantity Extraction (e.g., "2 dozen", "5 dz", "1 doz")
  const dozenMatch = normalized.match(/(\d+)\s*(dozen|dzn|dz|doz|dazan)/);
  if (dozenMatch) {
    entities.quantityDozen = parseInt(dozenMatch[1], 10);
  } else {
    // Check for just a number followed by word "boxes" or "boxes of jumbo" 
    // Usually customers say "2 jumbo" meaning 2 dozen jumbo
    const simpleNumMatch = normalized.match(/(\d+)\s+(jumbo|large|medium)/);
    if (simpleNumMatch) {
      entities.quantityDozen = parseInt(simpleNumMatch[1], 10);
    }
  }

  // 2. Size Extraction
  if (normalized.includes('jumbo')) entities.size = 'jumbo';
  else if (normalized.includes('large') || normalized.includes('lrg')) entities.size = 'large';
  else if (normalized.includes('medium') || normalized.includes('medm')) entities.size = 'medium';

  // 3. PinCode Extraction (Indian 6-digit format)
  const pinCodeMatch = normalized.match(/\b\d{6}\b/);
  if (pinCodeMatch) {
    entities.pinCode = pinCodeMatch[0];
  }

  // 4. City Extraction (Limited list for now, will expand)
  const cities = ['mumbai', 'thane', 'pune', 'bangalore', 'delhi', 'chennai', 'hyderabad', 'gurgaon', 'noida'];
  for (const city of cities) {
    if (normalized.includes(city)) {
      entities.city = city;
      break;
    }
  }

  // 5. Payment Mentions
  if (normalized.includes('paid') || normalized.includes('payment done') || normalized.includes('screenshot')) {
    entities.paymentMentioned = true;
  }

  // 6. Urgency
  if (normalized.includes('urgent') || normalized.includes('fast') || normalized.includes('today')) {
    entities.urgency = true;
  }

  // 7. Gifting
  if (normalized.includes('gift') || normalized.includes('surprise') || normalized.includes('for my')) {
    entities.gifting = true;
  }

  // 8. Address-like text
  if (
    normalized.includes('address') ||
    normalized.includes('landmark') ||
    normalized.includes('pincode') ||
    (entities.city && entities.pinCode)
  ) {
    entities.addressText = text.trim();
  }

  return entities;
};
