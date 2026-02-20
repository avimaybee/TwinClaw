import { logThought } from '../utils/logger.js';
import type { WsHub } from './websocket-hub.js';
import type { WsEventTopic } from '../types/websocket.js';
import type { IncidentManager } from '../services/incident-manager.js';
import type { RuntimeBudgetGovernor } from '../services/runtime-budget-governor.js';
import type { Dispatcher } from '../interfaces/dispatcher.js';
import type { ModelRouter } from '../services/model-router.js';
import { getCallbackOutcomeCounts } from '../services/db.js';

const DEFAULT_PUBLISH_INTERVAL_MS = 5_000;

export interface RuntimeEventProducerDeps {
    hub: WsHub;
    incidentManager?: IncidentManager;
    budgetGovernor?: RuntimeBudgetGovernor;
    dispatcher?: Dispatcher;
    modelRouter?: ModelRouter;
}

export interface RuntimeEventProducerConfig {
    publishIntervalMs?: number;
}

/**
 * Collects state from existing runtime services on a fixed interval and
 * publishes typed event envelopes through the WebSocket hub.
 *
 * Also responds to new-subscription callbacks from the hub by dispatching an
 * immediate full-state snapshot so newly connected clients receive current
 * state without waiting for the next polling cycle.
 */
export class RuntimeEventProducer {
    readonly #hub: WsHub;
    readonly #deps: Omit<RuntimeEventProducerDeps, 'hub'>;
    readonly #intervalMs: number;
    #timer: ReturnType<typeof setInterval> | null = null;

    constructor(deps: RuntimeEventProducerDeps, config: RuntimeEventProducerConfig = {}) {
        const { hub, ...rest } = deps;
        this.#hub = hub;
        this.#deps = rest;
        this.#intervalMs = config.publishIntervalMs ?? DEFAULT_PUBLISH_INTERVAL_MS;

        // When a client subscribes, immediately send a full snapshot
        this.#hub.onSubscribe = (clientId, topics) => {
            this.#dispatchSnapshotTo(clientId, topics);
        };
    }

    start(): void {
        if (this.#timer) return;
        this.#timer = setInterval(() => {
            this.#publishAll();
        }, this.#intervalMs);
        void logThought('[RuntimeEventProducer] Started periodic event publishing.');
    }

    stop(): void {
        if (this.#timer) {
            clearInterval(this.#timer);
            this.#timer = null;
        }
        void logThought('[RuntimeEventProducer] Stopped.');
    }

    // ── Snapshot ───────────────────────────────────────────────────────────────

    /**
     * Build a full-state snapshot keyed by topic for the given set of topics.
     * Used for initial snapshot on subscription and for testing.
     */
    collectSnapshot(topics?: WsEventTopic[]): Record<string, unknown> {
        const all = !topics || topics.length === 0;
        const include = (t: WsEventTopic) => all || topics!.includes(t);
        const snapshot: Record<string, unknown> = {};

        if (include('incidents') && this.#deps.incidentManager) {
            snapshot.incidents = {
                safeMode: this.#deps.incidentManager.isSafeModeEnabled(),
                current: this.#deps.incidentManager.getCurrentIncidents(),
            };
        }

        if (include('routing') && this.#deps.modelRouter) {
            snapshot.routing = this.#deps.modelRouter.getHealthSnapshot();
        }

        if (include('reliability') && this.#deps.dispatcher) {
            snapshot.reliability = this.#buildReliabilityPayload();
        }

        return snapshot;
    }

    // ── Private Helpers ────────────────────────────────────────────────────────

    #publishAll(): void {
        if (this.#deps.incidentManager) {
            this.#hub.publish('incidents', {
                safeMode: this.#deps.incidentManager.isSafeModeEnabled(),
                current: this.#deps.incidentManager.getCurrentIncidents(),
            });
        }

        if (this.#deps.modelRouter) {
            this.#hub.publish('routing', this.#deps.modelRouter.getHealthSnapshot());
        }

        if (this.#deps.dispatcher) {
            this.#hub.publish('reliability', this.#buildReliabilityPayload());
        }
    }

    #buildReliabilityPayload(): Record<string, unknown> {
        const queueMetrics = this.#deps.dispatcher!.queue.getStats() ?? null;
        const callbackCounts = getCallbackOutcomeCounts();
        return {
            queue: queueMetrics,
            callbacks: {
                totalAccepted: callbackCounts.accepted,
                totalDuplicate: callbackCounts.duplicate,
                totalRejected: callbackCounts.rejected,
            },
        };
    }

    #dispatchSnapshotTo(clientId: string, subscribedTopics: WsEventTopic[]): void {
        const snapshot = this.collectSnapshot(subscribedTopics);
        if (Object.keys(snapshot).length === 0) return;
        this.#hub.sendSnapshotTo(clientId, snapshot);
        void logThought(`[RuntimeEventProducer] Dispatched initial snapshot to client ${clientId}.`);
    }
}
