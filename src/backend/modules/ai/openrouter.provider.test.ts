import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createCompletion } = vi.hoisted(() => ({
  createCompletion: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: createCompletion,
      },
    };
  },
}));

vi.mock('@/backend/config/env', () => ({
  env: {
    OPENROUTER_API_KEY: 'test-openrouter-key',
    OPENAI_API_KEY: 'test-openai-key',
    APP_BASE_URL: 'https://example.com',
    AI_MODEL: 'openai/gpt-4o-mini',
    AI_REQUEST_TIMEOUT_MS: 1_000,
    AI_MAX_RETRIES: 2,
    AI_RETRY_BASE_DELAY_MS: 0,
    LOG_LEVEL: 'error',
  },
}));

import { OpenRouterProvider } from '@/backend/modules/ai/openrouter.provider';

describe('openrouter.provider', () => {
  beforeEach(() => {
    createCompletion.mockReset();
  });

  it('retries once on retryable provider errors and returns the recovered response', async () => {
    createCompletion
      .mockRejectedValueOnce(
        Object.assign(new Error('Rate limit exceeded'), {
          status: 429,
          headers: new Headers({
            'retry-after': '0',
          }),
        })
      )
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Recovered reply',
            },
          },
        ],
      });

    const provider = new OpenRouterProvider();
    const result = await provider.generateCompletion([
      {
        role: 'user',
        content: 'hi',
      },
    ]);

    expect(result).toBe('Recovered reply');
    expect(createCompletion).toHaveBeenCalledTimes(2);
  });

  it('falls back from developer to system role when the provider rejects developer messages', async () => {
    createCompletion
      .mockRejectedValueOnce(
        Object.assign(new Error("Unsupported value: 'developer' role"), {
          status: 400,
        })
      )
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Compatibility reply',
            },
          },
        ],
      });

    const provider = new OpenRouterProvider();
    const result = await provider.generateCompletion([
      {
        role: 'developer',
        content: 'Use concise sales language.',
      },
      {
        role: 'user',
        content: 'Need mango pricing',
      },
    ]);

    expect(result).toBe('Compatibility reply');
    expect(createCompletion).toHaveBeenCalledTimes(2);
    expect(createCompletion.mock.calls[1]?.[0]?.messages).toEqual([
      {
        role: 'system',
        content: 'Use concise sales language.',
      },
      {
        role: 'user',
        content: 'Need mango pricing',
      },
    ]);
  });
});
