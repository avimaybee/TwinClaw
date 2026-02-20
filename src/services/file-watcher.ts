import { watch, type FSWatcher } from 'chokidar';
import { logThought } from '../utils/logger.js';
import type {
    FileEvent,
    FileEventListener,
    FileEventType,
    WatchTarget,
} from '../types/file-watcher.js';

const DEFAULT_EXCLUDE = ['**/node_modules/**', '**/.git/**', '**/dist/**'];

/**
 * Monitors specific local directories for filesystem changes and notifies
 * registered listeners.
 *
 * Uses `chokidar` for cross-platform, efficient file watching with debouncing
 * and glob-based filtering.
 *
 * Usage:
 * ```ts
 * const watcher = new FileWatcherService();
 * watcher.addTarget({
 *   id: 'workspace',
 *   directory: '/path/to/project',
 *   exclude: ['node_modules/**'],
 * });
 * watcher.onEvent((event) => console.log(event));
 * watcher.startAll();
 * ```
 */
export class FileWatcherService {
    readonly #targets: Map<string, WatchTarget> = new Map();
    readonly #watchers: Map<string, FSWatcher> = new Map();
    readonly #listeners: Set<FileEventListener> = new Set();

    /** Register a directory to watch. Does NOT start watching until `start()` is called. */
    addTarget(target: WatchTarget): void {
        if (this.#targets.has(target.id)) {
            throw new Error(`[FileWatcher] Target '${target.id}' is already registered.`);
        }
        this.#targets.set(target.id, target);
    }

    /** Remove a target and close its watcher if running. */
    async removeTarget(targetId: string): Promise<boolean> {
        const existing = this.#watchers.get(targetId);
        if (existing) {
            await existing.close();
            this.#watchers.delete(targetId);
        }
        return this.#targets.delete(targetId);
    }

    /** Subscribe to all file events. Returns an unsubscribe function. */
    onEvent(listener: FileEventListener): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    /** Start watching a specific target by ID. */
    async start(targetId: string): Promise<void> {
        const target = this.#targets.get(targetId);
        if (!target) {
            throw new Error(`[FileWatcher] Target '${targetId}' is not registered.`);
        }

        if (this.#watchers.has(targetId)) return; // Already watching

        const ignored = [...DEFAULT_EXCLUDE, ...(target.exclude ?? [])];

        const watcher = watch(target.directory, {
            ignored,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 300,
                pollInterval: 100,
            },
        });

        const eventTypes: FileEventType[] = ['add', 'change', 'unlink', 'addDir', 'unlinkDir'];

        for (const eventType of eventTypes) {
            watcher.on(eventType, (filePath: string) => {
                void this.#handleEvent(eventType, filePath);
            });
        }

        watcher.on('error', (err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[FileWatcher] Error on target '${targetId}':`, message);
        });

        this.#watchers.set(targetId, watcher);

        await logThought(`[FileWatcher] Started watching '${targetId}' at ${target.directory}`);
    }

    /** Start watching all registered targets. */
    async startAll(): Promise<void> {
        for (const targetId of this.#targets.keys()) {
            await this.start(targetId);
        }
    }

    /** Stop watching a specific target. */
    async stop(targetId: string): Promise<void> {
        const watcher = this.#watchers.get(targetId);
        if (!watcher) return;

        await watcher.close();
        this.#watchers.delete(targetId);

        await logThought(`[FileWatcher] Stopped watching '${targetId}'.`);
    }

    /** Stop all watchers gracefully. */
    async stopAll(): Promise<void> {
        for (const [targetId, watcher] of this.#watchers) {
            await watcher.close();
            await logThought(`[FileWatcher] Stopped watching '${targetId}'.`);
        }
        this.#watchers.clear();
    }

    /** Return a list of currently active watch target IDs. */
    activeTargets(): string[] {
        return [...this.#watchers.keys()];
    }

    // ── Private Helpers ────────────────────────────────────────────────────────

    async #handleEvent(type: FileEventType, filePath: string): Promise<void> {
        const event: FileEvent = {
            type,
            path: filePath,
            timestamp: new Date().toISOString(),
        };

        await logThought(
            `[FileWatcher] ${type.toUpperCase()} detected: ${filePath}`,
        );

        for (const listener of this.#listeners) {
            try {
                await listener(event);
            } catch (err) {
                console.error('[FileWatcher] Listener threw an error:', err);
            }
        }
    }
}
