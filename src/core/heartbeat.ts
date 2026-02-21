import { JobScheduler } from '../services/job-scheduler.js';
import { logThought } from '../utils/logger.js';
import { getConfigValue } from '../config/config-loader.js';

export interface HeartbeatConfig {
  cronExpression?: string;
  message?: string;
}

export type HeartbeatCallback = (message: string) => Promise<void> | void;

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
  readonly #scheduler: JobScheduler;
  readonly #onHeartbeat: HeartbeatCallback;
  readonly #cronExpression: string;
  readonly #message: string;

  /**
   * @param onHeartbeat - callback invoked on every heartbeat tick.
   * @param config      - optional cron and message overrides.
   * @param scheduler   - optional external scheduler instance (for shared management).
   *                      If omitted, a private scheduler is created internally.
   */
  constructor(
    onHeartbeat: HeartbeatCallback,
    config: HeartbeatConfig = {},
    scheduler?: JobScheduler,
  ) {
    this.#onHeartbeat = onHeartbeat;
    this.#cronExpression = config.cronExpression ?? getConfigValue('HEARTBEAT_CRON') ?? DEFAULT_CRON;
    this.#message = config.message ?? getConfigValue('HEARTBEAT_MESSAGE') ?? DEFAULT_MESSAGE;
    this.#scheduler = scheduler ?? new JobScheduler();
  }

  /** Expose the underlying scheduler so callers can register additional jobs. */
  get scheduler(): JobScheduler {
    return this.#scheduler;
  }

  start(): void {
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

  stop(): void {
    this.#scheduler.unregister(HEARTBEAT_JOB_ID);
  }
}