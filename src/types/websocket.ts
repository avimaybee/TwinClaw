// ── Close Codes ────────────────────────────────────────────────────────────────

/** Deterministic close codes for WebSocket control-plane lifecycle events. */
export const WsCloseCode = {
    /** Authentication token missing or invalid. */
    AuthFailed: 4001,
    /** Client did not complete auth handshake within the required window. */
    AuthRequired: 4002,
    /** Subscription request contains an unrecognised topic. */
    InvalidSubscription: 4003,
    /** Client failed to respond to ping heartbeats (stale). */
    StaleConnection: 4004,
    /** Server is shutting down gracefully. */
    ServerShutdown: 4005,
} as const;

export type WsCloseCode = (typeof WsCloseCode)[keyof typeof WsCloseCode];

// ── Event Topics ───────────────────────────────────────────────────────────────

/** All subscribable runtime event topics. */
export type WsEventTopic = 'health' | 'reliability' | 'incidents' | 'routing';

// ── Inbound Messages (client → server) ────────────────────────────────────────

/** First message a client MUST send to authenticate the session. */
export interface WsAuthMessage {
    type: 'auth';
    /** Must equal the configured API_SECRET. */
    token: string;
}

/** Subscribe to one or more event topics (sent after auth_ok). */
export interface WsSubscribeMessage {
    type: 'subscribe';
    topics: WsEventTopic[];
}

/** Client-initiated ping to keep the connection alive. */
export interface WsPingMessage {
    type: 'ping';
}

export type WsInboundMessage = WsAuthMessage | WsSubscribeMessage | WsPingMessage;

// ── Outbound Messages (server → client) ────────────────────────────────────────

/** Sent after a successful authentication handshake. */
export interface WsAuthOkMessage {
    type: 'auth_ok';
    clientId: string;
    ts: string;
}

/** Acknowledgement for a successful subscription request. */
export interface WsSubscribedMessage {
    type: 'subscribed';
    topics: WsEventTopic[];
    ts: string;
}

/** Server-originated error notification. */
export interface WsErrorMessage {
    type: 'error';
    code: number;
    message: string;
    ts: string;
}

/** Response to a client ping. */
export interface WsPongMessage {
    type: 'pong';
    ts: string;
}

// ── Event Envelope ─────────────────────────────────────────────────────────────

/**
 * Versioned, typed wrapper for all runtime state update events.
 *
 * Every event emitted over the WebSocket channel is wrapped in this envelope
 * so consumers can version-check, sequence, and timestamp inbound frames.
 */
export interface WsEventEnvelope<T = unknown> {
    type: 'event';
    /** Schema version — increment when the envelope shape changes. */
    v: 1;
    topic: WsEventTopic;
    /** Monotonically increasing sequence number per hub instance. */
    seq: number;
    /** ISO-8601 server-side emission timestamp. */
    ts: string;
    payload: T;
}

// ── Snapshot Payload ───────────────────────────────────────────────────────────

/**
 * Initial full-state snapshot dispatched to a client immediately after it
 * subscribes. Only topics the client subscribed to are populated.
 */
export interface WsSnapshotPayload {
    type: 'snapshot';
    v: 1;
    ts: string;
    health?: unknown;
    reliability?: unknown;
    incidents?: unknown;
    routing?: unknown;
}

// ── Hub Diagnostics ────────────────────────────────────────────────────────────

/** Operator-facing metrics for the WebSocket hub. */
export interface WsHubMetrics {
    activeClients: number;
    totalConnections: number;
    authFailures: number;
    droppedEvents: number;
    staleCleaned: number;
    lastEventAt: string | null;
}
