import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { WsHub } from '../../src/api/websocket-hub.js';
import { WsCloseCode } from '../../src/types/websocket.js';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../src/services/secret-vault.js', () => ({
    getSecretVaultService: () => ({
        readSecret: (key: string) => (key === 'API_SECRET' ? 'test-secret' : null),
    }),
}));

vi.mock('../../src/utils/logger.js', () => ({
    logThought: vi.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Spin up a throwaway HTTP server with the hub attached and return both. */
function createTestServer(config?: ConstructorParameters<typeof WsHub>[0]) {
    const hub = new WsHub({
        authTimeoutMs: 200,
        heartbeatIntervalMs: 1_000_000, // don't fire during tests
        ...config,
    });

    const httpServer = createServer();
    hub.attach(httpServer);

    return new Promise<{ hub: WsHub; port: number; teardown: () => Promise<void> }>(
        (resolve, reject) => {
            httpServer.listen(0, '127.0.0.1', () => {
                const addr = httpServer.address() as { port: number };
                resolve({
                    hub,
                    port: addr.port,
                    teardown: () =>
                        new Promise((res) => {
                            hub.stop();
                            httpServer.close(() => res());
                        }),
                });
            });
            httpServer.once('error', reject);
        },
    );
}

/** Open a raw WS connection to the test server and return it. */
function openWs(port: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
    });
}

/** Wait for the next parsed message from a WebSocket. */
function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        ws.once('message', (data) => {
            try {
                resolve(JSON.parse(data.toString()));
            } catch {
                reject(new Error(`Non-JSON message: ${data}`));
            }
        });
        ws.once('close', () => reject(new Error('WebSocket closed before message')));
    });
}

/** Collect all messages until the socket closes. */
function collectUntilClose(ws: WebSocket): Promise<Array<Record<string, unknown>>> {
    const msgs: Array<Record<string, unknown>> = [];
    return new Promise((resolve) => {
        ws.on('message', (data) => {
            try {
                msgs.push(JSON.parse(data.toString()));
            } catch { /* ignore */ }
        });
        ws.once('close', () => resolve(msgs));
    });
}

/** Send a JSON message on a WebSocket. */
function send(ws: WebSocket, msg: unknown): void {
    ws.send(JSON.stringify(msg));
}

/** Authenticate + subscribe a fresh client in one shot. Returns the WS. */
async function authenticatedClient(port: number, topics = ['incidents', 'routing'] as const) {
    const ws = await openWs(port);

    // auth
    send(ws, { type: 'auth', token: 'test-secret' });
    const authOk = await nextMessage(ws);
    if (authOk.type !== 'auth_ok') throw new Error(`Expected auth_ok, got ${authOk.type}`);

    // subscribe
    send(ws, { type: 'subscribe', topics });
    const subscribed = await nextMessage(ws);
    if (subscribed.type !== 'subscribed') throw new Error(`Expected subscribed, got ${subscribed.type}`);

    return ws;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('WsHub — Phase 1: Handshake & Auth', () => {
    let hub: WsHub;
    let port: number;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
        ({ hub, port, teardown } = await createTestServer());
    });

    afterEach(async () => {
        await teardown();
    });

    it('accepts a valid auth token and replies with auth_ok', async () => {
        const ws = await openWs(port);
        send(ws, { type: 'auth', token: 'test-secret' });
        const msg = await nextMessage(ws);

        expect(msg.type).toBe('auth_ok');
        expect(typeof msg.clientId).toBe('string');
        expect(typeof msg.ts).toBe('string');
        ws.close();
    });

    it('rejects an invalid token with close code 4001', async () => {
        const ws = await openWs(port);
        const msgs = collectUntilClose(ws);

        send(ws, { type: 'auth', token: 'wrong-secret' });

        const received = await msgs;
        const errorMsg = received.find((m) => m.type === 'error');
        expect(errorMsg?.code).toBe(WsCloseCode.AuthFailed);
    });

    it('closes with 4002 if auth is not sent within timeout window', async () => {
        const ws = await openWs(port);

        await new Promise<void>((resolve, reject) => {
            ws.once('close', (code) => {
                try {
                    expect(code).toBe(WsCloseCode.AuthRequired);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    });

    it('increments authFailures metric on invalid token', async () => {
        const ws = await openWs(port);
        send(ws, { type: 'auth', token: 'bad' });
        await new Promise((res) => ws.once('close', res));

        expect(hub.getMetrics().authFailures).toBe(1);
    });

    it('returns error for malformed JSON', async () => {
        const ws = await openWs(port);
        // First auth
        send(ws, { type: 'auth', token: 'test-secret' });
        await nextMessage(ws); // auth_ok

        ws.send('not-json{{{');
        const errorMsg = await nextMessage(ws);
        expect(errorMsg.type).toBe('error');
        ws.close();
    });

    it('returns error for unknown message type', async () => {
        const ws = await openWs(port);
        send(ws, { type: 'auth', token: 'test-secret' });
        await nextMessage(ws); // auth_ok

        send(ws, { type: 'unknown_type' });
        const errorMsg = await nextMessage(ws);
        expect(errorMsg.type).toBe('error');
        ws.close();
    });
});

describe('WsHub — Phase 1: Subscription', () => {
    let port: number;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
        ({ port, teardown } = await createTestServer());
    });

    afterEach(async () => {
        await teardown();
    });

    it('allows subscribing to valid topics after auth', async () => {
        const ws = await openWs(port);
        send(ws, { type: 'auth', token: 'test-secret' });
        await nextMessage(ws); // auth_ok

        send(ws, { type: 'subscribe', topics: ['incidents', 'routing'] });
        const msg = await nextMessage(ws);

        expect(msg.type).toBe('subscribed');
        expect(msg.topics).toEqual(expect.arrayContaining(['incidents', 'routing']));
        ws.close();
    });

    it('returns error for invalid topic names but still subscribes valid ones', async () => {
        const ws = await openWs(port);
        send(ws, { type: 'auth', token: 'test-secret' });
        await nextMessage(ws); // auth_ok

        // Both the error and subscribed messages are sent synchronously by the hub.
        // Collect two messages in one promise to avoid the race where the second
        // message arrives before the second nextMessage listener is registered.
        const twoMessages = new Promise<[Record<string, unknown>, Record<string, unknown>]>((resolve, reject) => {
            const received: Record<string, unknown>[] = [];
            const onMsg = (data: Buffer | string) => {
                try {
                    received.push(JSON.parse(data.toString()));
                    if (received.length >= 2) {
                        ws.off('message', onMsg);
                        resolve([received[0], received[1]]);
                    }
                } catch (e) {
                    reject(e);
                }
            };
            ws.on('message', onMsg);
            ws.once('close', () => reject(new Error('Closed before 2 messages')));
        });

        send(ws, { type: 'subscribe', topics: ['incidents', 'not_a_topic'] });

        const [err, subscribed] = await twoMessages;
        expect(err.type).toBe('error');
        expect(err.code).toBe(WsCloseCode.InvalidSubscription);
        expect(subscribed.type).toBe('subscribed');
        expect(subscribed.topics).toEqual(['incidents']);
        ws.close();
    });

    it('rejects subscribe before auth', async () => {
        const ws = await openWs(port);
        send(ws, { type: 'subscribe', topics: ['health'] });
        const msg = await nextMessage(ws);
        expect(msg.type).toBe('error');
        expect(msg.code).toBe(WsCloseCode.AuthRequired);
        ws.close();
    });

    it('invokes onSubscribe callback with clientId and topics', async () => {
        const { hub, port: p, teardown: td } = await createTestServer();
        const received: { clientId: string; topics: string[] }[] = [];
        hub.onSubscribe = (cid, topics) => received.push({ clientId: cid, topics: [...topics] });

        const ws = await authenticatedClient(p, ['incidents'] as const);
        expect(received).toHaveLength(1);
        expect(received[0].topics).toEqual(['incidents']);
        ws.close();
        await td();
    });
});

describe('WsHub — Phase 2: Event Delivery', () => {
    let hub: WsHub;
    let port: number;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
        ({ hub, port, teardown } = await createTestServer());
    });

    afterEach(async () => {
        await teardown();
    });

    it('delivers published events to subscribed clients', async () => {
        const ws = await authenticatedClient(port, ['incidents'] as const);

        const msgPromise = nextMessage(ws);
        hub.publish('incidents', { safeMode: false, current: [] });
        const msg = await msgPromise;

        expect(msg.type).toBe('event');
        expect(msg.topic).toBe('incidents');
        expect(msg.v).toBe(1);
        expect(typeof msg.seq).toBe('number');
        expect(typeof msg.ts).toBe('string');
        ws.close();
    });

    it('does NOT deliver events to clients not subscribed to that topic', async () => {
        // Subscribe only to 'incidents', not 'routing'
        const ws = await authenticatedClient(port, ['incidents'] as const);

        hub.publish('routing', { fallbackMode: 'intelligent_pacing' });

        // We expect no message — use a small timeout
        const msg = await Promise.race([
            nextMessage(ws),
            new Promise<null>((res) => setTimeout(() => res(null), 150)),
        ]);
        expect(msg).toBeNull();
        ws.close();
    });

    it('delivers events to multiple clients subscribed to the same topic', async () => {
        const ws1 = await authenticatedClient(port, ['routing'] as const);
        const ws2 = await authenticatedClient(port, ['routing'] as const);

        const [p1, p2] = [nextMessage(ws1), nextMessage(ws2)];
        hub.publish('routing', { fallbackMode: 'aggressive_fallback' });

        const [m1, m2] = await Promise.all([p1, p2]);
        expect(m1.type).toBe('event');
        expect(m2.type).toBe('event');
        ws1.close();
        ws2.close();
    });

    it('increments the seq number for each published event', async () => {
        const ws = await authenticatedClient(port, ['incidents'] as const);

        hub.publish('incidents', {});
        const first = await nextMessage(ws);

        hub.publish('incidents', {});
        const second = await nextMessage(ws);

        expect(typeof first.seq).toBe('number');
        expect(typeof second.seq).toBe('number');
        expect((second.seq as number) - (first.seq as number)).toBe(1);
        ws.close();
    });

    it('sends a snapshot to a specific client via sendSnapshotTo', async () => {
        let capturedClientId = '';
        hub.onSubscribe = (clientId) => {
            capturedClientId = clientId;
        };

        const ws = await authenticatedClient(port, ['incidents'] as const);
        expect(capturedClientId).not.toBe('');

        const msgPromise = nextMessage(ws);
        hub.sendSnapshotTo(capturedClientId, { incidents: { safeMode: false, current: [] } });
        const msg = await msgPromise;

        expect(msg.type).toBe('snapshot');
        expect(msg.v).toBe(1);
        ws.close();
    });
});

describe('WsHub — Phase 2: Ping/Pong', () => {
    let port: number;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
        ({ port, teardown } = await createTestServer());
    });

    afterEach(async () => {
        await teardown();
    });

    it('responds to client ping with pong', async () => {
        const ws = await authenticatedClient(port);

        send(ws, { type: 'ping' });
        const msg = await nextMessage(ws);

        expect(msg.type).toBe('pong');
        expect(typeof msg.ts).toBe('string');
        ws.close();
    });
});

describe('WsHub — Phase 3: Diagnostics & Metrics', () => {
    let hub: WsHub;
    let port: number;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
        ({ hub, port, teardown } = await createTestServer());
    });

    afterEach(async () => {
        await teardown();
    });

    it('getMetrics returns zero counts initially', () => {
        const m = hub.getMetrics();
        expect(m.activeClients).toBe(0);
        expect(m.totalConnections).toBe(0);
        expect(m.authFailures).toBe(0);
        expect(m.droppedEvents).toBe(0);
        expect(m.staleCleaned).toBe(0);
        expect(m.lastEventAt).toBeNull();
    });

    it('tracks totalConnections after clients connect', async () => {
        const ws1 = await openWs(port);
        const ws2 = await openWs(port);

        expect(hub.getMetrics().totalConnections).toBe(2);
        ws1.close();
        ws2.close();
    });

    it('decrements activeClients after disconnect', async () => {
        const ws = await authenticatedClient(port);
        expect(hub.getMetrics().activeClients).toBeGreaterThan(0);

        await new Promise<void>((res) => {
            ws.on('close', res);
            ws.close();
        });

        // Small delay for cleanup
        await new Promise((r) => setTimeout(r, 50));
        expect(hub.getMetrics().activeClients).toBe(0);
    });

    it('updates lastEventAt after publish', async () => {
        const ws = await authenticatedClient(port, ['reliability'] as const);
        hub.publish('reliability', {});
        const msgPromise = nextMessage(ws);
        await msgPromise;

        expect(hub.getMetrics().lastEventAt).not.toBeNull();
        ws.close();
    });
});

describe('WsHub — Phase 3: Fallback Confirmation', () => {
    it('reconnect behavior: hub publish after auth failure does not crash', async () => {
        const { hub, port, teardown } = await createTestServer();

        const ws = await openWs(port);
        send(ws, { type: 'auth', token: 'bad-token' });

        await new Promise<void>((res) => ws.once('close', res));

        // Publishing while no clients are connected must not throw
        expect(() => hub.publish('incidents', {})).not.toThrow();
        expect(hub.getMetrics().activeClients).toBe(0);
        await teardown();
    });
});
