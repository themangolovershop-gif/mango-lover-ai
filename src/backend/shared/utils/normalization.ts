/**
 * Normalization dictionary for common mango-shop related typos and abbreviations.
 */
const REPLACEMENT_DICT: Record<string, string> = {
  'dazan': 'dozen',
  'dzn': 'dozen',
  'doz': 'dozen',
  'dozens': 'dozen',
  'orginal': 'original',
  'devgad': 'devgad',
  'alpanso': 'alphonso',
  'alfanso': 'alphonso',
  'phonso': 'alphonso',
  'pric': 'price',
  'prce': 'price',
  'prise': 'price',
  'medm': 'medium',
  'lrg': 'large',
  'jumboo': 'jumbo',
  'locat': 'location',
  'adress': 'address',
  'qulity': 'quality',
  'qualtiy': 'quality',
  'quntity': 'quantity',
  'quanti': 'quantity',
  'kal': 'tomorrow', // 'kal' in Hindi means yesterday/tomorrow
  'delivery?': 'delivery request',
  'payment don': 'payment done',
  'paid': 'payment done',
  'sent': 'payment submitted',
};

/**
 * Normalizes messy buyer text for structured analysis.
 * Handles:
 * - Lowercase cleaning
 * - Whitespace cleanup
 * - Common typo normalization
 * - Basic punctuation removal
 */
export const normalizeMessage = (input: string): string => {
  if (!input) return '';

  // 1. Basic cleanup
  let normalized = input.toLowerCase().trim();
  
  // 2. Remove non-essential punctuation that might mess up keyword matching
  // Keep numbers and letters
  normalized = normalized.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, ' ');
  normalized = normalized.replace(/\s{2,}/g, ' '); // Collapse double spaces

  // 3. Typo/Abbreviation Replacement
  const words = normalized.split(' ');
  const replacedWords = words.map(word => REPLACEMENT_DICT[word] || word);
  
  normalized = replacedWords.join(' ');

  // 4. Handle specific multi-word phrases if needed
  if (normalized.includes('payment don') || normalized.includes('done payment')) {
    normalized = normalized.replace('payment don', 'payment done').replace('done payment', 'payment done');
  }

  return normalized.trim();
};
