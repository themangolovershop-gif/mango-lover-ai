import { describe, expect, it } from 'vitest';

import { searchBusinessKnowledge, searchMangoKnowledge } from '@/backend/modules/knowledge/knowledge.service';

describe('knowledge.service', () => {
  it('retrieves natural ripening knowledge for mango questions', () => {
    const articles = searchMangoKnowledge('natural ripening means what');

    expect(articles[0]?.id).toBe('mango-natural-ripening');
  });

  it('retrieves premium positioning knowledge for business questions', () => {
    const articles = searchBusinessKnowledge('why your mangoes premium');

    expect(articles[0]?.id).toBe('business-premium-positioning');
  });
});
