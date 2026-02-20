import { JobScheduler } from '../services/job-scheduler.js';
import { logThought } from '../utils/logger.js';
const DEFAULT_CRON = '0 9 * * *';
const DEFAULT_MESSAGE = 'TwinClaw heartbeat: daily proactive check-in.';
const HEARTBEAT_JOB_ID = 'twinclaw-heartbeat';
/**
 * Proactive heartbeat service.
 *
 * Now delegates to the centralized {@link JobScheduler} so heartbeat intervals
 * are managed alongside other repeating background jobs. The external API
 * remains identical to the original implementation for backward compatibility.
 */
export class HeartbeatService {
    #scheduler;
    #onHeartbeat;
    #cronExpression;
    #message;
    /**
     * @param onHeartbeat - callback invoked on every heartbeat tick.
     * @param config      - optional cron and message overrides.
     * @param scheduler   - optional external scheduler instance (for shared management).
     *                      If omitted, a private scheduler is created internally.
     */
    constructor(onHeartbeat, config = {}, scheduler) {
        this.#onHeartbeat = onHeartbeat;
        this.#cronExpression = config.cronExpression ?? process.env.HEARTBEAT_CRON ?? DEFAULT_CRON;
        this.#message = config.message ?? process.env.HEARTBEAT_MESSAGE ?? DEFAULT_MESSAGE;
        this.#scheduler = scheduler ?? new JobScheduler();
    }
    /** Expose the underlying scheduler so callers can register additional jobs. */
    get scheduler() {
        return this.#scheduler;
    }
    start() {
        // Guard against double-start
        if (this.#scheduler.getJob(HEARTBEAT_JOB_ID)) {
            return;
        }
        this.#scheduler.register({
            id: HEARTBEAT_JOB_ID,
            cronExpression: this.#cronExpression,
            description: this.#message,
            handler: async () => {
                await logThought(`Heartbeat fired with schedule: ${this.#cronExpression}`);
                await this.#onHeartbeat(this.#message);
            },
            autoStart: true,
        });
    }
    stop() {
        this.#scheduler.unregister(HEARTBEAT_JOB_ID);
    }
}
