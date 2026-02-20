import { randomUUID } from 'node:crypto';
import type {
    DeliveryRecord,
    DeliveryAttempt,
    ReliabilityMetrics,
    CallbackReconciliation,
} from '../types/reliability.js';
import { logThought } from '../utils/logger.js';

const MAX_HISTORY = 200;

/**
 * Tracks outbound message delivery outcomes for reliability telemetry.
 *
 * Maintains an in-memory ring buffer of delivery records. Each send operation
 * is recorded with its attempts, timing, and final outcome. Provides summary
 * metrics for dashboards and operational visibility.
 *
 * Not thread-safe — designed for single-process Node.js usage.
 */
export class DeliveryTracker {
    readonly #records: DeliveryRecord[] = [];
    readonly #reconciliations: CallbackReconciliation[] = [];

    /** Create a new delivery record and return its ID. */
    createRecord(platform: string, chatId: string | number): string {
        const id = randomUUID();
        const record: DeliveryRecord = {
            id,
            platform,
            chatId,
            state: 'pending',
            attempts: [],
            createdAt: new Date().toISOString(),
        };

        this.#records.push(record);

        // Trim ring buffer
        if (this.#records.length > MAX_HISTORY) {
            this.#records.splice(0, this.#records.length - MAX_HISTORY);
        }

        return id;
    }

    /** Record the start of a send attempt. */
    recordAttemptStart(recordId: string): void {
        const record = this.#findRecord(recordId);
        if (!record) return;

        const attempt: DeliveryAttempt = {
            attemptNumber: record.attempts.length + 1,
            startedAt: new Date().toISOString(),
        };

        record.attempts.push(attempt);
        record.state = record.attempts.length === 1 ? 'sending' : 'retrying';
    }

    /** Mark the latest attempt as successful. */
    recordSuccess(recordId: string): void {
        const record = this.#findRecord(recordId);
        if (!record) return;

        const last = record.attempts[record.attempts.length - 1];
        if (last) {
            last.completedAt = new Date().toISOString();
            last.durationMs = new Date(last.completedAt).getTime() - new Date(last.startedAt).getTime();
        }

        record.state = 'sent';
        record.resolvedAt = new Date().toISOString();
    }

    /** Mark the latest attempt as failed. */
    recordFailure(recordId: string, error: string): void {
        const record = this.#findRecord(recordId);
        if (!record) return;

        const last = record.attempts[record.attempts.length - 1];
        if (last) {
            last.completedAt = new Date().toISOString();
            last.error = error;
            last.durationMs = new Date(last.completedAt).getTime() - new Date(last.startedAt).getTime();
        }
    }

    /** Mark a record as ultimately failed (all retries exhausted). */
    markFailed(recordId: string): void {
        const record = this.#findRecord(recordId);
        if (!record) return;

        record.state = 'failed';
        record.resolvedAt = new Date().toISOString();

        void logThought(
            `[DeliveryTracker] Message ${recordId} FAILED after ${record.attempts.length} attempt(s) to ${record.platform}:${record.chatId}.`,
        );
    }

    /** Record an external callback reconciliation event. */
    recordReconciliation(payload: CallbackReconciliation): void {
        this.#reconciliations.push(payload);

        if (this.#reconciliations.length > MAX_HISTORY) {
            this.#reconciliations.splice(0, this.#reconciliations.length - MAX_HISTORY);
        }

        void logThought(
            `[DeliveryTracker] Callback reconciled — task: ${payload.taskId}, status: ${payload.status}.`,
        );
    }

    /** Compute reliability metrics from the current record history. */
    getMetrics(limit = 50): ReliabilityMetrics {
        const resolved = this.#records.filter(
            (r) => r.state === 'sent' || r.state === 'failed',
        );

        const totalSent = resolved.filter((r) => r.state === 'sent').length;
        const totalFailed = resolved.filter((r) => r.state === 'failed').length;
        const totalRetries = resolved.reduce(
            (sum, r) => sum + Math.max(0, r.attempts.length - 1),
            0,
        );
        const averageAttempts =
            resolved.length > 0
                ? resolved.reduce((sum, r) => sum + r.attempts.length, 0) / resolved.length
                : 0;

        return {
            totalSent,
            totalFailed,
            totalRetries,
            averageAttempts: Math.round(averageAttempts * 100) / 100,
            recentRecords: this.#records.slice(-limit),
        };
    }

    // ── Private ───────────────────────────────────────────────────────────────

    #findRecord(id: string): DeliveryRecord | undefined {
        return this.#records.find((r) => r.id === id);
    }
}
