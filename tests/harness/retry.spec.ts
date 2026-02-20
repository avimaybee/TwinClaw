import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../../src/utils/retry.js';

describe('withRetry', () => {
  it('returns success immediately when the operation succeeds on first attempt', async () => {
    const fn = vi.fn(async () => 'ok');

    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 0 });

    expect(result.ok).toBe(true);
    expect(result.value).toBe('ok');
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries failed operations and eventually succeeds', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('transient-failure'))
      .mockResolvedValueOnce('recovered');

    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 0,
      backoffFactor: 2,
      label: 'retry-recovery',
    });

    expect(result.ok).toBe(true);
    expect(result.value).toBe('recovered');
    expect(result.attempts).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('returns a failed result after exhausting all attempts', async () => {
    const fn = vi.fn(async () => {
      throw new Error('permanent-failure');
    });

    const result = await withRetry(fn, {
      maxAttempts: 2,
      baseDelayMs: 0,
      label: 'retry-exhausted',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('permanent-failure');
    expect(result.attempts).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
