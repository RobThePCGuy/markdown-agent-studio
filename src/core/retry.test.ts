import { describe, it, expect, vi } from 'vitest';
import { isRetryableError, retryWithBackoff } from './retry';

// ---------------------------------------------------------------------------
// isRetryableError
// ---------------------------------------------------------------------------

describe('isRetryableError', () => {
  it('returns true for errors with retryable status codes', () => {
    for (const status of [429, 500, 502, 503, 529]) {
      const err = Object.assign(new Error('fail'), { status });
      expect(isRetryableError(err)).toBe(true);
    }
  });

  it('returns false for non-retryable status codes', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const err = Object.assign(new Error('fail'), { status });
      expect(isRetryableError(err)).toBe(false);
    }
  });

  it('returns true for retryable message patterns', () => {
    const messages = [
      'rate limit exceeded',
      'Rate_Limit reached',
      'Too Many Requests',
      'server overloaded',
      'temporarily unavailable',
      'request timeout',
      'ECONNRESET',
      'ETIMEDOUT',
      'fetch failed',
    ];
    for (const msg of messages) {
      expect(isRetryableError(new Error(msg))).toBe(true);
    }
  });

  it('returns false for non-retryable messages', () => {
    expect(isRetryableError(new Error('invalid api key'))).toBe(false);
    expect(isRetryableError(new Error('model not found'))).toBe(false);
    expect(isRetryableError(new Error('content policy violation'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isRetryableError('string error')).toBe(false);
    expect(isRetryableError(42)).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// retryWithBackoff
// ---------------------------------------------------------------------------

describe('retryWithBackoff', () => {
  it('returns immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, 3);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient errors and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate limit'), { status: 429 }))
      .mockResolvedValueOnce('recovered');

    const result = await retryWithBackoff(fn, 3);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable error without retrying', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401 }));

    await expect(retryWithBackoff(fn, 3)).rejects.toThrow('unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts all attempts then throws the last error', async () => {
    const err = Object.assign(new Error('overloaded'), { status: 503 });
    const fn = vi.fn().mockRejectedValue(err);

    await expect(retryWithBackoff(fn, 3)).rejects.toThrow('overloaded');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('skips retries when abort signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const err = Object.assign(new Error('rate limit'), { status: 429 });
    const fn = vi.fn().mockRejectedValue(err);

    await expect(retryWithBackoff(fn, 3, controller.signal)).rejects.toThrow('rate limit');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops retrying when abort signal fires during backoff', async () => {
    const controller = new AbortController();

    const err = Object.assign(new Error('rate limit'), { status: 429 });
    const fn = vi.fn().mockRejectedValue(err);

    // Abort after a very short delay to interrupt the backoff sleep
    setTimeout(() => controller.abort(), 50);

    await expect(retryWithBackoff(fn, 5, controller.signal)).rejects.toThrow('rate limit');
    // Should have attempted once, then been aborted during backoff before attempt 2
    // (or possibly squeezed in attempt 2 — the key assertion is < 5)
    expect(fn.mock.calls.length).toBeLessThan(5);
  });

  it('respects the 200ms backoff floor (delay is never near-instant)', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate limit'), { status: 429 }))
      .mockResolvedValueOnce('ok');

    const start = Date.now();
    await retryWithBackoff(fn, 3);
    const elapsed = Date.now() - start;

    // The backoff floor is 200ms, so the total should be at least ~180ms
    // (allowing for timer imprecision)
    expect(elapsed).toBeGreaterThanOrEqual(150);
  });

  it('cleans up abort listener after backoff sleep completes normally', async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    const fn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate limit'), { status: 429 }))
      .mockResolvedValueOnce('ok');

    await retryWithBackoff(fn, 3, controller.signal);

    // removeEventListener should have been called to clean up the abort listener
    expect(removeSpy.mock.calls.some(
      ([event]) => event === 'abort'
    )).toBe(true);
    removeSpy.mockRestore();
  });
});
