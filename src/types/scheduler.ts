/** Status of a registered scheduled job. */
export type JobStatus = 'idle' | 'running' | 'stopped' | 'error';

/** Configuration required to register a new repeating job. */
export interface JobConfig {
    /** Unique human-readable identifier for this job (e.g. 'daily-heartbeat'). */
    id: string;
    /** A cron expression defining the schedule (node-cron format). */
    cronExpression: string;
    /** Human-readable description of what this job does. */
    description: string;
    /** The async callback to execute on each tick. */
    handler: () => Promise<void> | void;
    /**
     * If true, the job will start immediately upon registration.
     * @default true
     */
    autoStart?: boolean;
}

/** Read-only snapshot of a registered job's state. */
export interface JobSnapshot {
    id: string;
    cronExpression: string;
    description: string;
    status: JobStatus;
    lastRunAt: Date | null;
    lastError: string | null;
}

/**
 * Event types emitted by the job scheduler.
 * - 'job:start'  — fired just before a job handler executes.
 * - 'job:done'   — fired after a job handler completes successfully.
 * - 'job:error'  — fired when a job handler throws.
 */
export type SchedulerEventType = 'job:start' | 'job:done' | 'job:error';

export interface SchedulerEvent {
    type: SchedulerEventType;
    jobId: string;
    timestamp: Date;
    error?: string;
}

/** Callback signature for scheduler event listeners. */
export type SchedulerEventListener = (event: SchedulerEvent) => void;
