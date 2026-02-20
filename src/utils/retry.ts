import { logThought } from './logger.js';

/** Configuration for the retry helper. */
export interface RetryOptions {
    /** Maximum number of attempts (including the first). @default 3 */
    maxAttempts?: number;
    /** Base delay in ms before the first retry. @default 1000 */
    baseDelayMs?: number;
    /** Multiplier applied to the delay after each failed attempt. @default 2 */
    backoffFactor?: number;
    /** Maximum delay cap in ms. @default 15000 */
    maxDelayMs?: number;
    /** Label used in log messages for traceability. */
    label?: string;
}

/** Result of a retried operation. */
export interface RetryResult<T> {
    ok: boolean;
    value?: T;
    error?: string;
    attempts: number;
    totalDurationMs: number;
}

const DEFAULTS: Required<Omit<RetryOptions, 'label'>> = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    backoffFactor: 2,
    maxDelayMs: 15_000,
};

/**
 * Execute an async function with bounded exponential backoff retry.
 *
 * - Retries up to `maxAttempts` times on failure.
 * - Delay doubles after each attempt (capped at `maxDelayMs`).
 * - All attempts are logged for postmortem traceability.
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => telegram.sendText(chatId, text),
 *   { maxAttempts: 3, label: 'telegram:sendText' },
 * );
 * ```
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {},
): Promise<RetryResult<T>> {
    const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
    const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
    const backoffFactor = options.backoffFactor ?? DEFAULTS.backoffFactor;
    const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
    const label = options.label ?? 'unnamed';

    const start = Date.now();
    let lastError = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const value = await fn();
            const totalDurationMs = Date.now() - start;

            if (attempt > 1) {
                void logThought(
                    `[Retry] ${label} succeeded on attempt ${attempt}/${maxAttempts} (${totalDurationMs}ms).`,
                );
            }

            return { ok: true, value, attempts: attempt, totalDurationMs };
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);

            if (attempt < maxAttempts) {
                const delay = Math.min(baseDelayMs * backoffFactor ** (attempt - 1), maxDelayMs);
                void logThought(
                    `[Retry] ${label} attempt ${attempt}/${maxAttempts} failed: ${lastError}. Retrying in ${delay}ms.`,
                );
                await sleep(delay);
            } else {
                void logThought(
                    `[Retry] ${label} exhausted all ${maxAttempts} attempts. Last error: ${lastError}.`,
                );
            }
        }
    }

    return {
        ok: false,
        error: lastError,
        attempts: maxAttempts,
        totalDurationMs: Date.now() - start,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
