import cron from 'node-cron';
import { logThought } from '../utils/logger.js';
/**
 * Centralized job scheduler for TwinClaw's proactive execution layer.
 *
 * Wraps `node-cron` to manage multiple named, repeating background jobs
 * with event emission, error isolation, and runtime inspection.
 *
 * Usage:
 * ```ts
 * const scheduler = new JobScheduler();
 * scheduler.register({
 *   id: 'daily-heartbeat',
 *   cronExpression: '0 9 * * *',
 *   description: 'Morning proactive check-in',
 *   handler: async () => { … },
 * });
 * scheduler.startAll();
 * ```
 */
export class JobScheduler {
    #jobs = new Map();
    #listeners = new Map();
    /** Register a new repeating job. Throws if a job with the same ID already exists. */
    register(config) {
        if (this.#jobs.has(config.id)) {
            throw new Error(`[JobScheduler] Job '${config.id}' is already registered.`);
        }
        if (!cron.validate(config.cronExpression)) {
            throw new Error(`[JobScheduler] Invalid cron expression for job '${config.id}': ${config.cronExpression}`);
        }
        const entry = {
            config,
            task: null,
            status: 'idle',
            lastRunAt: null,
            lastError: null,
        };
        this.#jobs.set(config.id, entry);
        const autoStart = config.autoStart ?? true;
        if (autoStart) {
            this.#startJob(entry);
        }
    }
    /** Unregister and stop a job by ID. */
    unregister(jobId) {
        const entry = this.#jobs.get(jobId);
        if (!entry)
            return false;
        entry.task?.stop();
        this.#jobs.delete(jobId);
        return true;
    }
    /** Start a specific job by ID. No-op if already running. */
    start(jobId) {
        const entry = this.#jobs.get(jobId);
        if (!entry) {
            throw new Error(`[JobScheduler] Job '${jobId}' is not registered.`);
        }
        this.#startJob(entry);
    }
    /** Stop a specific job by ID. No-op if already stopped. */
    stop(jobId) {
        const entry = this.#jobs.get(jobId);
        if (!entry) {
            throw new Error(`[JobScheduler] Job '${jobId}' is not registered.`);
        }
        if (entry.task) {
            entry.task.stop();
            entry.task = null;
            entry.status = 'stopped';
        }
    }
    /** Start all registered jobs that are not currently running. */
    startAll() {
        for (const entry of this.#jobs.values()) {
            if (!entry.task) {
                this.#startJob(entry);
            }
        }
    }
    /** Stop all running jobs gracefully. */
    stopAll() {
        for (const entry of this.#jobs.values()) {
            if (entry.task) {
                entry.task.stop();
                entry.task = null;
                entry.status = 'stopped';
            }
        }
    }
    /** Return a read-only snapshot of all registered jobs. */
    listJobs() {
        const snapshots = [];
        for (const entry of this.#jobs.values()) {
            snapshots.push({
                id: entry.config.id,
                cronExpression: entry.config.cronExpression,
                description: entry.config.description,
                status: entry.status,
                lastRunAt: entry.lastRunAt,
                lastError: entry.lastError,
            });
        }
        return snapshots;
    }
    /** Get a single job's snapshot by ID. Returns `undefined` if not found. */
    getJob(jobId) {
        const entry = this.#jobs.get(jobId);
        if (!entry)
            return undefined;
        return {
            id: entry.config.id,
            cronExpression: entry.config.cronExpression,
            description: entry.config.description,
            status: entry.status,
            lastRunAt: entry.lastRunAt,
            lastError: entry.lastError,
        };
    }
    /** Subscribe to scheduler events. Returns an unsubscribe function. */
    on(eventType, listener) {
        let set = this.#listeners.get(eventType);
        if (!set) {
            set = new Set();
            this.#listeners.set(eventType, set);
        }
        set.add(listener);
        return () => {
            set?.delete(listener);
        };
    }
    // ── Private Helpers ────────────────────────────────────────────────────────
    #startJob(entry) {
        if (entry.task)
            return; // Already running
        entry.task = cron.schedule(entry.config.cronExpression, async () => {
            await this.#executeJob(entry);
        });
        entry.status = 'idle';
    }
    async #executeJob(entry) {
        const { config } = entry;
        entry.status = 'running';
        entry.lastRunAt = new Date();
        this.#emit({ type: 'job:start', jobId: config.id, timestamp: new Date() });
        try {
            await logThought(`[JobScheduler] Executing job '${config.id}' (${config.cronExpression}).`);
            await config.handler();
            entry.status = 'idle';
            entry.lastError = null;
            this.#emit({ type: 'job:done', jobId: config.id, timestamp: new Date() });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            entry.status = 'error';
            entry.lastError = message;
            console.error(`[JobScheduler] Job '${config.id}' failed:`, message);
            await logThought(`[JobScheduler] Job '${config.id}' failed: ${message}`);
            this.#emit({ type: 'job:error', jobId: config.id, timestamp: new Date(), error: message });
        }
    }
    #emit(event) {
        const listeners = this.#listeners.get(event.type);
        if (!listeners)
            return;
        for (const listener of listeners) {
            try {
                listener(event);
            }
            catch (listenerErr) {
                console.error('[JobScheduler] Event listener threw an error:', listenerErr);
            }
        }
    }
}
