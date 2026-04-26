import { describe, expect, it } from 'vitest';

import { detectIntents } from '@/backend/modules/ai/intent.service';

describe('intent.service', () => {
  it('detects shorthand pricing questions like "Pric" as pricing intent', () => {
    const result = detectIntents('Pric');

    expect(result.primaryIntent).toBe('pricing');
  });

  it('does not misclassify "chahiye" as a greeting and treats it as buying intent', () => {
    const result = detectIntents('2 dozen large chahiye');

    expect(result.primaryIntent).toBe('order_start');
  });

  it('detects quality questions even when they end with a question mark', () => {
    const result = detectIntents('quality?');

    expect(result.primaryIntent).toBe('quality_check');
  });
});
