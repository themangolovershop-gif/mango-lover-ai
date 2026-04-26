import OpenAI from 'openai';
import type { AIChatMessage, AICompletionOptions, AIProvider } from './provider';
import { env } from '../../config/env';
import { withRetry, parseRetryAfterMs } from '@/backend/shared/lib/http/retry';
import { logger } from '@/backend/shared/lib/logger';

function getProviderErrorStatus(error: unknown) {
  return typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
    ? error.status
    : null;
}

function getProviderErrorCode(error: unknown) {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : null;
}

function getProviderErrorName(error: unknown) {
  return error instanceof Error ? error.name : null;
}

function getProviderErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown AI provider error';
}

function getHeaderValue(headers: unknown, headerName: string) {
  if (!headers || typeof headers !== 'object') {
    return null;
  }

  if ('get' in headers && typeof headers.get === 'function') {
    const value = headers.get(headerName);
    return typeof value === 'string' ? value : null;
  }

  const matchingEntry = Object.entries(headers).find(
    ([key, value]) =>
      key.toLowerCase() === headerName.toLowerCase() && typeof value === 'string'
  );

  return matchingEntry?.[1] ?? null;
}

function getRetryableAiDecision(error: unknown) {
  const status = getProviderErrorStatus(error);
  const code = getProviderErrorCode(error)?.toUpperCase();
  const name = getProviderErrorName(error);
  const retryAfterMs = parseRetryAfterMs(
    getHeaderValue(
      typeof error === 'object' && error !== null && 'headers' in error ? error.headers : null,
      'retry-after'
    )
  );

  if (status !== null && ([408, 409, 429].includes(status) || status >= 500)) {
    return {
      retryable: true,
      reason: `http_${status}`,
      delayMs: retryAfterMs,
    };
  }

  if (
    code &&
    ['ECONNABORTED', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT'].includes(code)
  ) {
    return {
      retryable: true,
      reason: code.toLowerCase(),
      delayMs: retryAfterMs,
    };
  }

  if (name && ['AbortError', 'APIConnectionError', 'APITimeoutError'].includes(name)) {
    return {
      retryable: true,
      reason: name,
      delayMs: retryAfterMs,
    };
  }

  return {
    retryable: false,
  };
}

function isDeveloperRoleCompatibilityError(error: unknown) {
  const status = getProviderErrorStatus(error);
  const message = getProviderErrorMessage(error).toLowerCase();

  if (status !== null && status >= 500) {
    return false;
  }

  return (
    message.includes('developer') &&
    (
      message.includes('role') ||
      message.includes('unsupported') ||
      message.includes('messages')
    )
  );
}

export class OpenRouterProvider implements AIProvider {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: env.OPENROUTER_API_KEY || env.OPENAI_API_KEY,
      timeout: env.AI_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
      defaultHeaders: {
        'HTTP-Referer': env.APP_BASE_URL,
        'X-Title': 'The Mango Lover Shop AI',
      },
    });
  }

  private async requestCompletion(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    options: AICompletionOptions
  ) {
    return this.client.chat.completions.create({
      model: env.AI_MODEL,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 150,
    });
  }

  private async requestCompletionWithRetry(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    options: AICompletionOptions,
    mode: 'primary' | 'compatibility'
  ) {
    return withRetry(
      () => this.requestCompletion(messages, options),
      {
        operation: `ai_completion_${mode}`,
        maxAttempts: env.AI_MAX_RETRIES,
        baseDelayMs: env.AI_RETRY_BASE_DELAY_MS,
        classifyError: getRetryableAiDecision,
        onRetry: ({ attempt, maxAttempts, nextDelayMs, reason, error }) => {
          logger.warn('ai.completion.retrying', {
            mode,
            attempt,
            maxAttempts,
            nextDelayMs,
            reason,
            statusCode: getProviderErrorStatus(error) ?? undefined,
            errorCode: getProviderErrorCode(error) ?? undefined,
            errorMessage: getProviderErrorMessage(error),
          });
        },
      }
    );
  }

  private toProviderMessages(messages: AIChatMessage[]) {
    return messages.map<OpenAI.Chat.Completions.ChatCompletionMessageParam>((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  async generateCompletion(messages: AIChatMessage[], options: AICompletionOptions = {}): Promise<string> {
    try {
      logger.info('ai.completion.requested', {
        model: env.AI_MODEL,
      });
      let response: OpenAI.Chat.Completions.ChatCompletion;

      try {
        response = await this.requestCompletionWithRetry(
          this.toProviderMessages(messages),
          options,
          'primary'
        );
      } catch (error) {
        if (
          !messages.some((message) => message.role === 'developer') ||
          !isDeveloperRoleCompatibilityError(error)
        ) {
          throw error;
        }

        logger.warn('ai.completion.compatibility_fallback', {
          model: env.AI_MODEL,
          statusCode: getProviderErrorStatus(error) ?? undefined,
          errorCode: getProviderErrorCode(error) ?? undefined,
          errorMessage: getProviderErrorMessage(error),
        });

        const compatibilityMessages = messages.map((message) => ({
          ...message,
          role: message.role === 'developer' ? ('system' as const) : message.role,
        }));

        response = await this.requestCompletionWithRetry(
          this.toProviderMessages(compatibilityMessages),
          options,
          'compatibility'
        );
      }

      const result = response.choices[0]?.message?.content?.trim() || 'I apologize, I am unable to generate a response at the moment.';
      logger.info('ai.completion.succeeded', {
        model: env.AI_MODEL,
        responseLength: result.length,
      });
      return result;
    } catch (error) {
      logger.error('ai.completion.failed', {
        model: env.AI_MODEL,
        statusCode: getProviderErrorStatus(error) ?? undefined,
        errorCode: getProviderErrorCode(error) ?? undefined,
        errorMessage: getProviderErrorMessage(error),
      });
      throw new Error('Failed to generate AI response');
    }
  }
}

export const aiProvider = new OpenRouterProvider();
