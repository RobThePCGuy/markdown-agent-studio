/** Transient HTTP status codes worth retrying. */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 529]);

/** Patterns in error messages that indicate a transient failure. */
const RETRYABLE_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /overloaded/i,
  /temporarily unavailable/i,
  /timeout/i,
  /ECONNRESET/,
  /ETIMEDOUT/,
  /fetch failed/i,
];

/**
 * Determine whether an error is transient and worth retrying.
 * Checks for HTTP status codes and common error message patterns.
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    // Check for status code on error objects (SDKs attach this)
    const status = (err as Error & { status?: number }).status;
    if (status !== undefined && RETRYABLE_STATUS_CODES.has(status)) return true;

    // Check message patterns
    if (RETRYABLE_PATTERNS.some((p) => p.test(err.message))) return true;
  }
  return false;
}

/**
 * Calculate backoff delay in ms with full jitter.
 * Formula: random(0, min(baseMs * 2^attempt, maxMs))
 */
function backoffDelay(attempt: number, baseMs = 1000, maxMs = 15000): number {
  const expDelay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  return Math.random() * expDelay;
}

/**
 * Sleep for the given number of milliseconds, aborting early if the
 * signal fires.
 */
function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/**
 * Retry an async function with exponential backoff + jitter.
 *
 * @param fn - The async operation to retry.
 * @param maxAttempts - Total attempts (including the first). Default 3.
 * @param signal - Optional AbortSignal; skips retries if aborted.
 * @returns The result of `fn` on the first successful attempt.
 * @throws The last error if all attempts fail.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  signal?: AbortSignal,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      // Don't retry non-transient errors or if aborted
      if (!isRetryableError(err) || signal?.aborted || attempt >= maxAttempts - 1) {
        throw err;
      }

      const delay = backoffDelay(attempt);
      await sleepWithAbort(delay, signal);

      if (signal?.aborted) throw err;
    }
  }
  throw lastErr;
}
