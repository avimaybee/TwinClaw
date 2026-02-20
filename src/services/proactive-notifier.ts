import { logThought } from '../utils/logger.js';
import type { SchedulerEvent } from '../types/scheduler.js';
import type { FileEvent } from '../types/file-watcher.js';

/**
 * Destination target for proactive outbound messages.
 * Currently supports Telegram; extend this union for future platforms.
 */
export interface ProactiveTarget {
    platform: 'telegram';
    chatId: string | number;
}

/** Callback that actually delivers a proactive message to a platform. */
export type ProactiveSendFn = (target: ProactiveTarget, text: string) => Promise<void>;

/**
 * Manages proactive (agent-initiated) outbound notifications.
 *
 * Acts as the bridge between background event sources (scheduler, file watcher)
 * and the dispatcher's outbound delivery. The notifier decides *what* to say,
 * and the dispatcher decides *how* to send it.
 *
 * Usage:
 * ```ts
 * const notifier = new ProactiveNotifier(sendFn, defaultTarget);
 * scheduler.on('job:error', (e) => notifier.onSchedulerEvent(e));
 * fileWatcher.onEvent((e) => notifier.onFileEvent(e));
 * ```
 */
export class ProactiveNotifier {
    readonly #send: ProactiveSendFn;
    readonly #defaultTarget: ProactiveTarget;
    #enabled: boolean;

    constructor(send: ProactiveSendFn, defaultTarget: ProactiveTarget, enabled = true) {
        this.#send = send;
        this.#defaultTarget = defaultTarget;
        this.#enabled = enabled;
    }

    /** Enable or disable proactive notifications at runtime. */
    setEnabled(value: boolean): void {
        this.#enabled = value;
    }

    get enabled(): boolean {
        return this.#enabled;
    }

    /**
     * Handle a scheduler event. Only job errors trigger proactive alerts.
     * Job starts/completions are logged but not dispatched to the user.
     */
    async onSchedulerEvent(event: SchedulerEvent): Promise<void> {
        if (!this.#enabled) return;

        switch (event.type) {
            case 'job:error': {
                const message =
                    `⚠️ **Background Job Failed**\n` +
                    `Job: \`${event.jobId}\`\n` +
                    `Error: ${event.error ?? 'Unknown error'}\n` +
                    `Time: ${event.timestamp.toISOString()}`;

                await this.#dispatch(message);
                break;
            }
            case 'job:done': {
                // Silently log — don't notify user for routine completions.
                await logThought(
                    `[ProactiveNotifier] Job '${event.jobId}' completed successfully.`,
                );
                break;
            }
            default:
                break;
        }
    }

    /**
     * Handle a file-system event. Only file additions and changes are reported
     * to avoid flooding the user with noise from deletions or directory events.
     */
    async onFileEvent(event: FileEvent): Promise<void> {
        if (!this.#enabled) return;

        if (event.type !== 'add' && event.type !== 'change') return;

        const label = event.type === 'add' ? '📄 New File Detected' : '✏️ File Modified';
        const message =
            `${label}\n` +
            `Path: \`${event.path}\`\n` +
            `Time: ${event.timestamp}`;

        await this.#dispatch(message);
    }

    /**
     * Send an arbitrary proactive message. This is the public API for
     * any subsystem that needs to push an agent-initiated notification.
     */
    async notify(text: string, target?: ProactiveTarget): Promise<void> {
        if (!this.#enabled) return;
        await this.#dispatch(text, target);
    }

    // ── Private Helpers ────────────────────────────────────────────────────────

    async #dispatch(text: string, target?: ProactiveTarget): Promise<void> {
        const destination = target ?? this.#defaultTarget;

        try {
            await logThought(`[ProactiveNotifier] Sending proactive message to ${destination.platform}:${destination.chatId}`);
            await this.#send(destination, text);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[ProactiveNotifier] Failed to deliver proactive message:', message);
            await logThought(`[ProactiveNotifier] Delivery failed: ${message}`);
        }
    }
}
