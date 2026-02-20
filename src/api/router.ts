import express from 'express';
import { handleHealth, type HealthDeps } from './handlers/health.js';
import { handleBrowserSnapshot, handleBrowserClick, type BrowserDeps } from './handlers/browser.js';
import { handleWebhookCallback, type CallbackDeps } from './handlers/callback.js';
import { requestLogger, requireSignature, sendError } from './shared.js';
import { BrowserService } from '../services/browser-service.js';
import type { SkillRegistry } from '../services/skill-registry.js';
import type { McpServerManager } from '../services/mcp-server-manager.js';
import type { HeartbeatService } from '../core/heartbeat.js';
import type { Gateway } from '../core/gateway.js';
import type { Dispatcher } from '../interfaces/dispatcher.js';
import { logThought } from '../utils/logger.js';
import { sendOk } from './shared.js';

export interface ApiServerDeps {
    heartbeat: HeartbeatService;
    skillRegistry: SkillRegistry;
    mcpManager: McpServerManager;
    gateway: Gateway;
    dispatcher?: Dispatcher;
}

const DEFAULT_PORT = 3100;

/**
 * Create and start the Control Plane HTTP API server.
 *
 * Endpoints:
 *   GET  /health              — System health snapshot
 *   GET  /reliability          — Delivery reliability metrics
 *   POST /browser/snapshot     — Take a browser screenshot + accessibility tree
 *   POST /browser/click        — Click an element by selector or coordinates
 *   POST /callback/webhook     — Ingest external task completion events (authenticated)
 */
export function startApiServer(deps: ApiServerDeps): void {
    const app = express();
    const port = Number(process.env.API_PORT) || DEFAULT_PORT;

    // ── Global Middleware ───────────────────────────────────────────────────────
    app.use(express.json());
    app.use(requestLogger);

    // ── Shared Services ─────────────────────────────────────────────────────────
    const browserService = new BrowserService();

    const healthDeps: HealthDeps = {
        heartbeat: deps.heartbeat,
        skillRegistry: deps.skillRegistry,
        mcpManager: deps.mcpManager,
    };

    const browserDeps: BrowserDeps = { browserService };
    const callbackDeps: CallbackDeps = { gateway: deps.gateway };

    // ── Routes ──────────────────────────────────────────────────────────────────
    app.get('/health', handleHealth(healthDeps));
    app.get('/reliability', (_req, res) => {
        const metrics = deps.dispatcher?.deliveryTracker.getMetrics();
        if (!metrics) {
            sendOk(res, { message: 'Dispatcher not active — no delivery data.' });
            return;
        }
        sendOk(res, metrics);
    });
    app.post('/browser/snapshot', handleBrowserSnapshot(browserDeps));
    app.post('/browser/click', handleBrowserClick(browserDeps));
    app.post('/callback/webhook', requireSignature, handleWebhookCallback(callbackDeps));

    // ── Catch-all 404 ──────────────────────────────────────────────────────────
    app.use((_req, res) => {
        sendError(res, 'Not found.', 404);
    });

    // ── Start ──────────────────────────────────────────────────────────────────
    app.listen(port, () => {
        console.log(`[TwinClaw API] Control plane listening on http://localhost:${port}`);
        void logThought(`[API] HTTP server started on port ${port}.`);
    });
}
