import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

vi.mock('@/backend/config/env', () => ({
  env: {
    NODE_ENV: 'production',
    WHATSAPP_ACCESS_TOKEN: 'meta-access-token',
    WHATSAPP_PHONE_NUMBER_ID: '1234567890',
    WHATSAPP_APP_SECRET: 'meta-app-secret',
    WHATSAPP_REQUEST_TIMEOUT_MS: 1_000,
    WHATSAPP_MAX_RETRIES: 2,
    WHATSAPP_RETRY_BASE_DELAY_MS: 0,
    LOG_LEVEL: 'error',
  },
}));

import { MetaWhatsAppProvider } from '@/backend/modules/whatsapp/meta-provider';

describe('meta-provider', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('retries once on explicit retryable Meta responses and returns the provider message id', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: 'Too many requests',
              type: 'OAuthException',
              code: 4,
              fbtrace_id: 'trace-1',
            },
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [
              {
                id: 'wamid.123',
              },
            ],
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        )
      );

    const provider = new MetaWhatsAppProvider();
    const result = await provider.sendTextMessage({
      to: '+919999999999',
      body: 'Your order is confirmed.',
    });

    expect(result.providerMessageId).toBe('wamid.123');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces Meta timeouts as a non-retryable provider timeout error', async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted.'), {
        name: 'AbortError',
      })
    );

    const provider = new MetaWhatsAppProvider();

    await expect(
      provider.sendTextMessage({
        to: '+919999999999',
        body: 'Following up on your order.',
      })
    ).rejects.toMatchObject({
      code: 'META_PROVIDER_TIMEOUT',
      statusCode: 504,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
