import { randomUUID } from 'node:crypto';
import { logThought } from '../utils/logger.js';
import {
    enqueueDelivery,
    dequeueDeliveries,
    updateDeliveryState,
    updateDeliveryAttempts,
    recordDeliveryAttemptStart,
    recordDeliveryAttemptEnd,
    getDeliveryStateCounts,
    getDeadLetters,
    getDeliveryMetrics,
    type DeliveryQueueRow,
} from './db.js';
import type { JobScheduler } from './job-scheduler.js';

export interface QueueServiceOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    backoffFactor?: number;
    maxDelayMs?: number;
    batchSize?: number;
    pollIntervalCron?: string; // Ex: '*/2 * * * * *' (every 2 seconds)
}

export type DispatchAdapter = (platform: string, chatId: string, textPayload: string) => Promise<void>;
export type QueueProcessingMode = 'normal' | 'throttled' | 'drain';

/** Runtime stats snapshot returned by {@link QueueService.getStats}. */
export interface QueueStats {
    totalQueued: number;
    totalDispatching: number;
    totalSent: number;
    totalFailed: number;
    totalDeadLetters: number;
    recentRecords: DeliveryQueueRow[];
    deadLetterRecords: DeliveryQueueRow[];
}

const DEFAULTS = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    backoffFactor: 2,
    maxDelayMs: 15_000,
    batchSize: 10,
    pollIntervalCron: '*/2 * * * * *', // Every 2 seconds
};

/**
 * Durable queue service for outbound message delivery.
 */
export class QueueService {
    readonly #dispatchFn: DispatchAdapter;
    readonly #maxAttempts: number;
    readonly #baseDelayMs: number;
    readonly #backoffFactor: number;
    readonly #maxDelayMs: number;
    readonly #batchSize: number;
    readonly #scheduler: JobScheduler;
    readonly #pollIntervalCron: string;
    #processingMode: QueueProcessingMode = 'normal';
    #retryWindowMultiplier = 1;

    constructor(dispatchFn: DispatchAdapter, scheduler: JobScheduler, options: QueueServiceOptions = {}) {
        this.#dispatchFn = dispatchFn;
        this.#scheduler = scheduler;
        this.#maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
        this.#baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
        this.#backoffFactor = options.backoffFactor ?? DEFAULTS.backoffFactor;
        this.#maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
        this.#batchSize = options.batchSize ?? DEFAULTS.batchSize;
        this.#pollIntervalCron = options.pollIntervalCron ?? DEFAULTS.pollIntervalCron;
    }

    start(): void {
        this.#scheduler.register({
            id: 'queue-processor',
            cronExpression: this.#pollIntervalCron,
            description: 'Process pending delivery queue items',
            handler: async () => {
                await this.processQueue();
            },
            autoStart: true,
        });
    }

    stop(): void {
        this.#scheduler.unregister('queue-processor');
    }

    enqueue(platform: string, chatId: string | number, textPayload: string): string {
        const id = randomUUID();
        enqueueDelivery(id, platform, String(chatId), textPayload);
        // Soft trigger for low latency
        setTimeout(() => void this.processQueue(), 50);
        return id;
    }

    async processQueue(): Promise<void> {
        const batch = dequeueDeliveries(this.#resolveBatchSize());
        if (!batch || batch.length === 0) return;

        // Process all picked deliveries concurrently
        await Promise.allSettled(batch.map((job) => this.#processJob(job)));
    }

    async #processJob(job: DeliveryQueueRow): Promise<void> {
        const attemptId = randomUUID();
        const start = Date.now();
        const startedAt = new Date(start).toISOString();

        recordDeliveryAttemptStart(attemptId, job.id, job.attempts, startedAt);

        let success = false;
        let lastError = '';

        try {
            await this.#dispatchFn(job.platform, job.chat_id, job.text_payload);
            success = true;
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
        }

        const end = Date.now();
        const completedAt = new Date(end).toISOString();
        const durationMs = end - start;

        recordDeliveryAttemptEnd(attemptId, completedAt, success ? null : lastError, durationMs);

        if (success) {
            updateDeliveryState(job.id, 'sent', completedAt);
        } else {
            if (job.attempts >= this.#maxAttempts) {
                updateDeliveryState(job.id, 'dead_letter', completedAt);
                void logThought(`[QueueService] Message ${job.id} dead-lettered after ${job.attempts} attempts. Last error: ${lastError}`);
            } else {
                const delayMs = Math.min(
                    this.#baseDelayMs * this.#backoffFactor ** (job.attempts - 1) * this.#retryWindowMultiplier,
                    this.#maxDelayMs,
                );
                const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();

                updateDeliveryAttempts(job.id, job.attempts, nextAttemptAt);
                updateDeliveryState(job.id, 'failed', null);

                void logThought(`[QueueService] Message ${job.id} failed attempt ${job.attempts}/${this.#maxAttempts}: ${lastError}. Retrying at ${nextAttemptAt}.`);
            }
        }
    }

    /** Requeue a dead letter for another set of attempts. */
    requeueDeadLetter(id: string): void {
        const now = new Date().toISOString();
        updateDeliveryAttempts(id, 0, now);
        updateDeliveryState(id, 'queued', null);
        void logThought(`[QueueService] Requeued dead-letter message ${id}.`);
        setTimeout(() => void this.processQueue(), 50);
    }

    setProcessingMode(mode: QueueProcessingMode): void {
        this.#processingMode = mode;
        void logThought(`[QueueService] Processing mode set to '${mode}'.`);
    }

    setRetryWindowMultiplier(multiplier: number): void {
        const clamped = Math.max(0.5, Math.min(6, Number.isFinite(multiplier) ? multiplier : 1));
        this.#retryWindowMultiplier = clamped;
        void logThought(`[QueueService] Retry window multiplier set to ${clamped}.`);
    }

    getRuntimeControls(): { mode: QueueProcessingMode; retryWindowMultiplier: number } {
        return {
            mode: this.#processingMode,
            retryWindowMultiplier: this.#retryWindowMultiplier,
        };
    }

    /** Expose stats for dashboard/metrics. */
    getStats(limit = 50): QueueStats {
        const recent = getDeliveryMetrics(limit);
        const counts = getDeliveryStateCounts();
        const deadLetters = getDeadLetters();

        return {
            totalQueued: counts.queued ?? 0,
            totalDispatching: counts.dispatching ?? 0,
            totalSent: counts.sent ?? 0,
            totalFailed: counts.failed ?? 0,
            totalDeadLetters: counts.dead_letter ?? deadLetters.length,
            recentRecords: recent,
            deadLetterRecords: deadLetters.slice(0, limit),
        };
    }

    #resolveBatchSize(): number {
        if (this.#processingMode === 'throttled') {
            return Math.max(1, Math.floor(this.#batchSize / 2));
        }
        if (this.#processingMode === 'drain') {
            return Math.min(this.#batchSize * 2, 100);
        }
        return this.#batchSize;
    }
}
