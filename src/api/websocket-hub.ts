import type { IncomingMessage, Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { logThought } from '../utils/logger.js';
import type { WsEventTopic, WsHubMetrics } from '../types/websocket.js';
import { WsCloseCode } from '../types/websocket.js';
import { getSecretVaultService } from '../services/secret-vault.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_AUTH_TIMEOUT_MS = 5_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
/** Default backpressure threshold in kilobytes (see WsHubConfig.maxClientQueue). */
const DEFAULT_MAX_CLIENT_QUEUE = 200;

const VALID_TOPICS = new Set<WsEventTopic>(['health', 'reliability', 'incidents', 'routing']);

// ── Internal Client State ──────────────────────────────────────────────────────

interface ClientState {
    id: string;
    ws: WebSocket;
    authenticated: boolean;
    subscriptions: Set<WsEventTopic>;
    authTimer: ReturnType<typeof setTimeout> | null;
    isAlive: boolean;
    connectedAt: number;
}

// ── Config ─────────────────────────────────────────────────────────────────────

export interface WsHubConfig {
    authTimeoutMs?: number;
    heartbeatIntervalMs?: number;
    /**
     * Per-client backpressure threshold in kilobytes.
     * When `ws.bufferedAmount` exceeds `maxClientQueue * 1024` bytes the event
     * is dropped rather than queued, preventing unbounded memory growth on
     * slow or unresponsive consumers.
     */
    maxClientQueue?: number;
}

// ── WsHub ──────────────────────────────────────────────────────────────────────

/**
 * Control-plane WebSocket hub.
 *
 * Responsibilities:
 *  - Authenticate clients via a shared-secret handshake within a configurable timeout.
 *  - Maintain a registry of authenticated, subscribed connections.
 *  - Fan-out typed event envelopes to clients subscribed to a given topic.
 *  - Enforce per-client bounded send queues to prevent slow-consumer back-pressure.
 *  - Run a ping/pong heartbeat and evict stale (unresponsive) clients.
 *  - Expose operator-facing diagnostics metrics.
 *  - Invoke an optional `onSubscribe` callback so the event producer can push an
 *    initial state snapshot immediately after a client subscribes.
 */
export class WsHub {
    readonly #config: Required<WsHubConfig>;
    readonly #clients: Map<string, ClientState> = new Map();
    #wss: WebSocketServer | null = null;
    #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    #seq = 0;

    #metrics = {
        totalConnections: 0,
        authFailures: 0,
        droppedEvents: 0,
        staleCleaned: 0,
        lastEventAt: null as string | null,
    };

    /**
     * Called when a client successfully subscribes to topics.
     * The event producer uses this to dispatch an initial snapshot.
     */
    onSubscribe: ((clientId: string, topics: WsEventTopic[]) => void) | null = null;

    constructor(config: WsHubConfig = {}) {
        this.#config = {
            authTimeoutMs: config.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS,
            heartbeatIntervalMs: config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
            maxClientQueue: config.maxClientQueue ?? DEFAULT_MAX_CLIENT_QUEUE,
        };
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    /**
     * Attach the WebSocket server to an existing HTTP server.
     * Must be called before the HTTP server starts accepting connections.
     */
    attach(server: Server): void {
        this.#wss = new WebSocketServer({ server, path: '/ws' });

        this.#wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
            this.#handleConnection(ws, req);
        });

        this.#heartbeatTimer = setInterval(() => {
            this.#runHeartbeat();
        }, this.#config.heartbeatIntervalMs);

        void logThought('[WsHub] WebSocket control-plane attached on /ws.');
    }

    /** Gracefully close all connections and shut down the hub. */
    stop(): void {
        if (this.#heartbeatTimer) {
            clearInterval(this.#heartbeatTimer);
            this.#heartbeatTimer = null;
        }

        for (const client of this.#clients.values()) {
            this.#closeClient(client, WsCloseCode.ServerShutdown, 'Server shutting down.');
        }
        this.#clients.clear();

        this.#wss?.close();
        this.#wss = null;
        void logThought('[WsHub] WebSocket hub stopped.');
    }

    // ── Publishing ─────────────────────────────────────────────────────────────

    /**
     * Publish a runtime event to all authenticated clients subscribed to `topic`.
     * Drops the oldest queued message for a client whose send buffer is full.
     */
    publish(topic: WsEventTopic, payload: unknown): void {
        const seq = ++this.#seq;
        const envelope = JSON.stringify({
            type: 'event',
            v: 1,
            topic,
            seq,
            ts: new Date().toISOString(),
            payload,
        });

        this.#metrics.lastEventAt = new Date().toISOString();

        for (const client of this.#clients.values()) {
            if (!client.authenticated || !client.subscriptions.has(topic)) continue;
            if (client.ws.readyState !== WebSocket.OPEN) continue;

            this.#sendRaw(client, envelope);
        }
    }

    /**
     * Send a full-state snapshot directly to a specific client.
     * Used for the initial snapshot immediately after subscription.
     */
    sendSnapshotTo(clientId: string, snapshot: Record<string, unknown>): void {
        const client = this.#clients.get(clientId);
        if (!client || !client.authenticated || client.ws.readyState !== WebSocket.OPEN) return;

        const msg = JSON.stringify({
            type: 'snapshot',
            v: 1,
            ts: new Date().toISOString(),
            ...snapshot,
        });

        this.#sendRaw(client, msg);
    }

    // ── Diagnostics ────────────────────────────────────────────────────────────

    /** Returns operator-facing connection and reliability metrics. */
    getMetrics(): WsHubMetrics {
        return {
            activeClients: this.#clients.size,
            totalConnections: this.#metrics.totalConnections,
            authFailures: this.#metrics.authFailures,
            droppedEvents: this.#metrics.droppedEvents,
            staleCleaned: this.#metrics.staleCleaned,
            lastEventAt: this.#metrics.lastEventAt,
        };
    }

    // ── Connection Handling ─────────────────────────────────────────────────────

    #handleConnection(ws: WebSocket, _req: IncomingMessage): void {
        const clientId = randomUUID();
        this.#metrics.totalConnections++;

        const client: ClientState = {
            id: clientId,
            ws,
            authenticated: false,
            subscriptions: new Set(),
            authTimer: null,
            isAlive: true,
            connectedAt: Date.now(),
        };

        this.#clients.set(clientId, client);

        // Enforce auth within timeout window
        client.authTimer = setTimeout(() => {
            if (!client.authenticated) {
                this.#metrics.authFailures++;
                void logThought(`[WsHub] Client ${clientId} auth timeout — closing connection.`);
                this.#closeClient(client, WsCloseCode.AuthRequired, 'Authentication required.');
            }
        }, this.#config.authTimeoutMs);

        ws.on('pong', () => {
            client.isAlive = true;
        });

        ws.on('message', (data: Buffer | string) => {
            this.#handleMessage(client, data);
        });

        ws.on('close', () => {
            this.#cleanupClient(client);
        });

        ws.on('error', (err: Error) => {
            void logThought(`[WsHub] Client ${clientId} socket error: ${err.message}`);
            this.#cleanupClient(client);
        });

        void logThought(`[WsHub] New connection: ${clientId}.`);
    }

    #handleMessage(client: ClientState, rawData: unknown): void {
        let msg: Record<string, unknown>;

        try {
            msg = JSON.parse(String(rawData));
        } catch {
            this.#sendError(client, 400, 'Invalid JSON.');
            return;
        }

        if (typeof msg !== 'object' || msg === null || typeof msg.type !== 'string') {
            this.#sendError(client, 400, 'Malformed message: missing "type" field.');
            return;
        }

        switch (msg.type) {
            case 'auth':
                this.#handleAuth(client, msg);
                break;
            case 'subscribe':
                this.#handleSubscribe(client, msg);
                break;
            case 'ping':
                this.#sendRaw(client, JSON.stringify({ type: 'pong', ts: new Date().toISOString() }));
                break;
            default:
                this.#sendError(client, 400, `Unknown message type: ${String(msg.type)}`);
        }
    }

    #handleAuth(client: ClientState, msg: Record<string, unknown>): void {
        const token = typeof msg.token === 'string' ? msg.token : '';
        const apiSecret = getSecretVaultService().readSecret('API_SECRET') ?? '';

        if (!apiSecret || !token || token !== apiSecret) {
            this.#metrics.authFailures++;
            void logThought(`[WsHub] Client ${client.id} authentication failed (invalid token).`);
            this.#sendError(client, WsCloseCode.AuthFailed, 'Authentication failed.');
            this.#closeClient(client, WsCloseCode.AuthFailed, 'Authentication failed.');
            return;
        }

        if (client.authTimer) {
            clearTimeout(client.authTimer);
            client.authTimer = null;
        }

        client.authenticated = true;
        this.#sendRaw(client, JSON.stringify({ type: 'auth_ok', clientId: client.id, ts: new Date().toISOString() }));
        void logThought(`[WsHub] Client ${client.id} authenticated.`);
    }

    #handleSubscribe(client: ClientState, msg: Record<string, unknown>): void {
        if (!client.authenticated) {
            this.#sendError(client, WsCloseCode.AuthRequired, 'Not authenticated.');
            return;
        }

        const rawTopics = Array.isArray(msg.topics) ? msg.topics : [];
        const validTopics: WsEventTopic[] = [];
        const invalidTopics: string[] = [];

        for (const t of rawTopics) {
            if (typeof t === 'string' && VALID_TOPICS.has(t as WsEventTopic)) {
                validTopics.push(t as WsEventTopic);
            } else {
                invalidTopics.push(String(t));
            }
        }

        if (invalidTopics.length > 0) {
            this.#sendError(
                client,
                WsCloseCode.InvalidSubscription,
                `Invalid topics: ${invalidTopics.join(', ')}. Valid topics: ${[...VALID_TOPICS].join(', ')}.`,
            );
            if (validTopics.length === 0) return;
        }

        for (const topic of validTopics) {
            client.subscriptions.add(topic);
        }

        this.#sendRaw(client, JSON.stringify({ type: 'subscribed', topics: validTopics, ts: new Date().toISOString() }));
        void logThought(`[WsHub] Client ${client.id} subscribed to [${validTopics.join(', ')}].`);

        if (this.onSubscribe && validTopics.length > 0) {
            this.onSubscribe(client.id, validTopics);
        }
    }

    // ── Heartbeat ──────────────────────────────────────────────────────────────

    #runHeartbeat(): void {
        for (const client of [...this.#clients.values()]) {
            if (!client.isAlive) {
                void logThought(`[WsHub] Client ${client.id} did not respond to ping — evicting stale connection.`);
                this.#metrics.staleCleaned++;
                this.#closeClient(client, WsCloseCode.StaleConnection, 'Stale connection.');
                continue;
            }

            client.isAlive = false;

            try {
                client.ws.ping();
            } catch {
                // If ping fails the close/error event will clean up
            }
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    #closeClient(client: ClientState, code: number, reason: string): void {
        if (client.authTimer) {
            clearTimeout(client.authTimer);
            client.authTimer = null;
        }

        try {
            client.ws.close(code, reason);
        } catch {
            // ignore — socket may already be closed
        }

        this.#clients.delete(client.id);
    }

    #cleanupClient(client: ClientState): void {
        if (client.authTimer) {
            clearTimeout(client.authTimer);
            client.authTimer = null;
        }

        this.#clients.delete(client.id);
        void logThought(`[WsHub] Client ${client.id} disconnected.`);
    }

    #sendRaw(client: ClientState, data: string): void {
        if (client.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        // Per-client backpressure: if the socket's internal buffer is large,
        // record a dropped event rather than allowing unbounded queue growth.
        if (client.ws.bufferedAmount > this.#config.maxClientQueue * 1024) {
            this.#metrics.droppedEvents++;
            void logThought(`[WsHub] Client ${client.id} backpressure limit hit — dropping event.`);
            return;
        }

        try {
            client.ws.send(data);
        } catch {
            this.#metrics.droppedEvents++;
        }
    }

    #sendError(client: ClientState, code: number, message: string): void {
        this.#sendRaw(
            client,
            JSON.stringify({ type: 'error', code, message, ts: new Date().toISOString() }),
        );
    }
}
