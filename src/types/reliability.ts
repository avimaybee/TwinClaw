/** Delivery lifecycle states for outbound messages in the persistent queue. */
export type DeliveryState = 'queued' | 'dispatching' | 'sent' | 'failed' | 'dead_letter';

/** A single tracked outbound delivery attempt. */
export interface DeliveryAttempt {
    attemptNumber: number;
    startedAt: string;
    completedAt?: string;
    error?: string;
    durationMs?: number;
}

/** Full delivery record for a single outbound message. */
export interface DeliveryRecord {
    id: string;
    platform: string;
    chatId: string | number;
    textPayload: string;
    state: DeliveryState;
    attempts: DeliveryAttempt[];
    createdAt: string;
    nextAttemptAt?: string;
    resolvedAt?: string;
}

/** Summary telemetry counters for reliability reporting. */
export interface ReliabilityMetrics {
    totalSent: number;
    totalFailed: number;
    totalRetries: number;
    averageAttempts: number;
    /** Delivery records for the most recent N sends. */
    recentRecords: DeliveryRecord[];
}

/** Callback reconciliation payload from an async interface operation. */
export interface CallbackReconciliation {
    taskId: string;
    platform: string;
    status: 'delivered' | 'failed' | 'expired';
    detail?: string;
    reconciledAt: string;
}
