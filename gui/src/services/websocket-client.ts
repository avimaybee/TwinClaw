// ── Reconnect Constants ────────────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_BACKOFF_FACTOR = 2;
const DEFAULT_AUTH_TIMEOUT_MS = 5_000;

/** Resolve the WebSocket base URL from the current browser origin at runtime. */
function defaultWsUrl(): string {
    if (typeof window !== 'undefined') {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host || 'localhost:3100';
        return `${proto}//${host}/ws`;
    }
    return 'ws://localhost:3100/ws';
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type WsEventTopic = 'health' | 'reliability' | 'incidents' | 'routing';

export interface WsEventEnvelope<T = unknown> {
    type: 'event';
    v: 1;
    topic: WsEventTopic;
    seq: number;
    ts: string;
    payload: T;
}

export interface WsSnapshotPayload {
    type: 'snapshot';
    v: 1;
    ts: string;
    health?: unknown;
    reliability?: unknown;
    incidents?: unknown;
    routing?: unknown;
}

export type WsConnectionState =
    | 'idle'
    | 'connecting'
    | 'authenticating'
    | 'ready'
    | 'reconnecting'
    | 'exhausted'
    | 'closed';

export interface WsClientOptions {
    url?: string;
    token: string;
    topics: WsEventTopic[];
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffFactor?: number;
    authTimeoutMs?: number;
}

export interface WsStreamState {
    connectionState: WsConnectionState;
    retryCount: number;
    lastError: string | null;
    incidents?: unknown;
    routing?: unknown;
    reliability?: unknown;
}

// ── WsClient ───────────────────────────────────────────────────────────────────

/**
 * Operator-side WebSocket client for the TwinClaw control-plane stream.
 *
 * Features:
 *  - Explicit auth handshake on every connection attempt.
 *  - Bounded exponential backoff reconnect (stops after maxRetries).
 *  - Emits parsed events/snapshots via a subscriber callback.
 *  - Exposes connection state so the GUI can show transport status.
 */
export class WsClient {
    readonly #opts: Required<WsClientOptions>;
    #ws: WebSocket | null = null;
    #retryCount = 0;
    #retryTimer: ReturnType<typeof setTimeout> | null = null;
    #authTimer: ReturnType<typeof setTimeout> | null = null;
    #connectionState: WsConnectionState = 'idle';
    #lastError: string | null = null;
    #closed = false;

    onEvent: ((envelope: WsEventEnvelope) => void) | null = null;
    onSnapshot: ((snapshot: WsSnapshotPayload) => void) | null = null;
    onStateChange: ((state: WsConnectionState) => void) | null = null;

    constructor(opts: WsClientOptions) {
        this.#opts = {
            url: opts.url ?? defaultWsUrl(),
            token: opts.token,
            topics: opts.topics,
            maxRetries: opts.maxRetries ?? DEFAULT_MAX_RETRIES,
            baseDelayMs: opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
            maxDelayMs: opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
            backoffFactor: opts.backoffFactor ?? DEFAULT_BACKOFF_FACTOR,
            authTimeoutMs: opts.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS,
        };
    }

    get connectionState(): WsConnectionState {
        return this.#connectionState;
    }

    get retryCount(): number {
        return this.#retryCount;
    }

    get lastError(): string | null {
        return this.#lastError;
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    connect(): void {
        if (this.#closed) return;
        this.#setState('connecting');
        this.#open();
    }

    close(): void {
        this.#closed = true;
        this.#clearTimers();
        this.#setState('closed');
        try {
            this.#ws?.close(1000, 'Client closed');
        } catch {
            // ignore
        }
        this.#ws = null;
    }

    // ── Private ────────────────────────────────────────────────────────────────

    #open(): void {
        if (this.#closed) return;

        try {
            this.#ws = new WebSocket(this.#opts.url);
        } catch (err) {
            this.#handleError(err instanceof Error ? err.message : String(err));
            return;
        }

        this.#ws.addEventListener('open', () => {
            this.#setState('authenticating');

            // Require auth_ok within timeout
            this.#authTimer = setTimeout(() => {
                this.#handleError('Authentication timeout');
            }, this.#opts.authTimeoutMs);

            this.#send({ type: 'auth', token: this.#opts.token });
        });

        this.#ws.addEventListener('message', (evt) => {
            this.#handleMessage(evt.data as string);
        });

        this.#ws.addEventListener('close', (evt) => {
            this.#clearTimers();
            if (!this.#closed) {
                this.#handleError(`Connection closed (code ${evt.code})`);
            }
        });

        this.#ws.addEventListener('error', () => {
            // The close event fires immediately after, so just log state
            this.#lastError = 'WebSocket error';
        });
    }

    #handleMessage(raw: string): void {
        let msg: Record<string, unknown>;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }

        if (typeof msg !== 'object' || msg === null) return;

        switch (msg.type) {
            case 'auth_ok':
                this.#clearAuthTimer();
                // Reset retry counter on successful auth
                this.#retryCount = 0;
                this.#send({ type: 'subscribe', topics: this.#opts.topics });
                break;

            case 'subscribed':
                this.#setState('ready');
                break;

            case 'snapshot':
                this.onSnapshot?.(msg as unknown as WsSnapshotPayload);
                break;

            case 'event':
                this.onEvent?.(msg as unknown as WsEventEnvelope);
                break;

            case 'pong':
                // Server-side heartbeat pong — no action needed
                break;

            case 'error':
                this.#lastError = typeof msg.message === 'string' ? msg.message : 'Server error';
                break;

            default:
                break;
        }
    }

    #handleError(reason: string): void {
        this.#lastError = reason;
        this.#clearTimers();
        this.#ws = null;

        if (this.#closed) return;

        if (this.#retryCount >= this.#opts.maxRetries) {
            this.#setState('exhausted');
            return;
        }

        const delay = Math.min(
            this.#opts.baseDelayMs * this.#opts.backoffFactor ** this.#retryCount,
            this.#opts.maxDelayMs,
        );
        this.#retryCount++;
        this.#setState('reconnecting');

        this.#retryTimer = setTimeout(() => {
            if (!this.#closed) {
                this.#setState('connecting');
                this.#open();
            }
        }, delay);
    }

    #send(msg: unknown): void {
        if (this.#ws?.readyState === WebSocket.OPEN) {
            try {
                this.#ws.send(JSON.stringify(msg));
            } catch {
                // ignore
            }
        }
    }

    #setState(state: WsConnectionState): void {
        if (this.#connectionState === state) return;
        this.#connectionState = state;
        this.onStateChange?.(state);
    }

    #clearTimers(): void {
        this.#clearAuthTimer();
        if (this.#retryTimer) {
            clearTimeout(this.#retryTimer);
            this.#retryTimer = null;
        }
    }

    #clearAuthTimer(): void {
        if (this.#authTimer) {
            clearTimeout(this.#authTimer);
            this.#authTimer = null;
        }
    }
}
