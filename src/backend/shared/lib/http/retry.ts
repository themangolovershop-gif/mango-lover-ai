export type RetryDecision = {
  retryable: boolean;
  reason?: string;
  delayMs?: number | null;
};

export type RetryContext = {
  attempt: number;
  maxAttempts: number;
  nextDelayMs: number;
  reason?: string;
  error: unknown;
};

type RetryOptions = {
  operation: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  classifyError?: (error: unknown) => RetryDecision;
  onRetry?: (context: RetryContext) => void;
};

function sleep(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function getDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number, delayOverride?: number | null) {
  if (typeof delayOverride === 'number' && Number.isFinite(delayOverride)) {
    return Math.max(0, Math.min(maxDelayMs, Math.round(delayOverride)));
  }

  const delayMs = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  return Math.max(0, Math.min(maxDelayMs, delayMs));
}

export function parseRetryAfterMs(retryAfter: string | null | undefined) {
  if (!retryAfter) {
    return null;
  }

  const asSeconds = Number(retryAfter);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1000);
  }

  const asDate = Date.parse(retryAfter);
  if (Number.isNaN(asDate)) {
    return null;
  }

  return Math.max(0, asDate - Date.now());
}

export async function withRetry<T>(
  operationFn: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 500);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 5_000);
  const classifyError = options.classifyError ?? (() => ({ retryable: false }));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operationFn(attempt);
    } catch (error) {
      const retryDecision = classifyError(error);

      if (!retryDecision.retryable || attempt >= maxAttempts) {
        throw error;
      }

      const nextDelayMs = getDelayMs(
        attempt,
        baseDelayMs,
        maxDelayMs,
        retryDecision.delayMs
      );

      options.onRetry?.({
        attempt,
        maxAttempts,
        nextDelayMs,
        reason: retryDecision.reason ?? options.operation,
        error,
      });

      await sleep(nextDelayMs);
    }
  }

  throw new Error(`Retry loop for ${options.operation} exited unexpectedly.`);
}
