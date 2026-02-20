/** Delivery lifecycle states for outbound messages. */
export type DeliveryState = 'pending' | 'sending' | 'retrying' | 'sent' | 'failed';

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
    state: DeliveryState;
    attempts: DeliveryAttempt[];
    createdAt: string;
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
