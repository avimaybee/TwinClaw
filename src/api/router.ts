import { createServer } from 'node:http';
import express from 'express';
import { handleHealth, handleLiveness, handleReadiness, type HealthDeps } from './handlers/health.js';
import { handleBrowserSnapshot, handleBrowserClick, type BrowserDeps } from './handlers/browser.js';
import { handleWebhookCallback, type CallbackDeps } from './handlers/callback.js';
import {
    handleSkillPackageDiagnostics,
    handleSkillPackageInstall,
    handleSkillPackageUpgrade,
    handleSkillPackageUninstall,
    type SkillPackageDeps,
} from './handlers/skill-packages.js';
import {
    handleLocalStateBackupDiagnostics,
    handleLocalStateCreateSnapshot,
    handleLocalStateRestoreSnapshot,
    type LocalStateBackupDeps,
} from './handlers/local-state-backup.js';
import {
    handlePersonaStateGet,
    handlePersonaStateUpdate,
    type PersonaStateDeps,
} from './handlers/persona-state.js';
import { handleConfigValidate } from './handlers/config-validate.js';
import { requestLogger, requireSignature, sendError } from './shared.js';
import { BrowserService } from '../services/browser-service.js';
import type { SkillRegistry } from '../services/skill-registry.js';
import type { McpServerManager } from '../services/mcp-server-manager.js';
import type { HeartbeatService } from '../core/heartbeat.js';
import type { Gateway } from '../core/gateway.js';
import type { Dispatcher } from '../interfaces/dispatcher.js';
import type { IncidentManager } from '../services/incident-manager.js';
import type { RuntimeBudgetGovernor } from '../services/runtime-budget-governor.js';
import type { LocalStateBackupService } from '../services/local-state-backup.js';
import type { ModelRouter } from '../services/model-router.js';
import { getPersonaStateService } from '../services/persona-state.js';
import { logThought } from '../utils/logger.js';
import { getCallbackOutcomeCounts } from '../services/db.js';
import { sendOk } from './shared.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { WsHub } from './websocket-hub.js';
import { getConfigValue } from '../config/config-loader.js';

export interface ApiServerDeps {
    heartbeat: HeartbeatService;
    skillRegistry: SkillRegistry;
    mcpManager: McpServerManager;
    gateway: Gateway;
    dispatcher?: Dispatcher;
    incidentManager?: IncidentManager;
    budgetGovernor?: RuntimeBudgetGovernor;
    localStateBackup?: LocalStateBackupService;
    modelRouter?: ModelRouter;
    wsHub?: WsHub;
}

const DEFAULT_PORT = 18789;

/**
 * Create and start the Control Plane HTTP API server.
 *
 * Endpoints:
 *   GET  /health              — System health snapshot
 *   GET  /config/validate     — Runtime config and env-key validation report
 *   GET  /backup/diagnostics  — Local backup + restore diagnostics
 *   POST /backup/snapshot     — Trigger manual local-state snapshot
 *   POST /backup/restore      — Restore local-state snapshot (dry-run supported)
 *   GET  /skills/packages     — Skill package diagnostics and compatibility state
 *   POST /skills/packages/*   — Install/upgrade/uninstall skill packages
 *   GET  /reliability          — Delivery reliability metrics
 *   GET  /budget/state         — Runtime budget state snapshot
 *   GET  /budget/events        — Recent budget policy events
 *   POST /budget/profile       — Manual profile override (signed)
 *   POST /budget/reset         — Reset budget policy state (signed)
 *   GET  /routing/telemetry    — Model routing telemetry snapshot
 *   POST /routing/mode         — Update model routing fallback mode (signed)
 *   GET  /incidents/current    — Active incident + safe-mode snapshot
 *   GET  /incidents/history    — Historical incidents and timeline events
 *   POST /incidents/evaluate   — Force immediate incident detection cycle
 *   GET  /persona/state        — Read persona source-of-truth state
 *   PUT  /persona/state        — Safely update persona source-of-truth state
 *   POST /browser/snapshot     — Take a browser screenshot + accessibility tree
 *   POST /browser/click        — Click an element by selector or coordinates
 *   POST /callback/webhook     — Ingest external task completion events (authenticated)
 */
export function startApiServer(deps: ApiServerDeps): void {
    const app = express();
    const port = Number(getConfigValue('API_PORT')) || DEFAULT_PORT;
    const server = createServer(app);

    // Attach WebSocket hub if provided
    if (deps.wsHub) {
        deps.wsHub.attach(server);
    }

    // ── Global Middleware ───────────────────────────────────────────────────────
    app.use(express.json());
    app.use(requestLogger);

    // ── Shared Services ─────────────────────────────────────────────────────────
    const browserService = new BrowserService();

    const healthDeps: HealthDeps = {
        heartbeat: deps.heartbeat,
        skillRegistry: deps.skillRegistry,
        mcpManager: deps.mcpManager,
        budgetGovernor: deps.budgetGovernor,
        localStateBackup: deps.localStateBackup,
        modelRouter: deps.modelRouter,
    };

    const browserDeps: BrowserDeps = { browserService };
    const callbackDeps: CallbackDeps = { gateway: deps.gateway };
    const skillPackageDeps: SkillPackageDeps = { mcpManager: deps.mcpManager };
    const localStateBackupDeps: LocalStateBackupDeps = { backupService: deps.localStateBackup };
    const personaStateDeps: PersonaStateDeps = {
        personaStateService: getPersonaStateService(),
    };

    // ── Routes ──────────────────────────────────────────────────────────────────
    app.get('/health', handleHealth(healthDeps));
    app.get('/health/live', handleLiveness());
    app.get('/health/ready', handleReadiness(healthDeps));

    // Protected endpoints
    app.get('/config/validate', requireSignature, handleConfigValidate());
    app.get('/backup/diagnostics', requireSignature, handleLocalStateBackupDiagnostics(localStateBackupDeps));
    app.post('/backup/snapshot', requireSignature, handleLocalStateCreateSnapshot(localStateBackupDeps));
    app.post('/backup/restore', requireSignature, handleLocalStateRestoreSnapshot(localStateBackupDeps));
    app.get('/skills/packages', requireSignature, handleSkillPackageDiagnostics(skillPackageDeps));
    app.post('/skills/packages/install', requireSignature, handleSkillPackageInstall(skillPackageDeps));
    app.post('/skills/packages/upgrade', requireSignature, handleSkillPackageUpgrade(skillPackageDeps));
    app.post('/skills/packages/uninstall', requireSignature, handleSkillPackageUninstall(skillPackageDeps));
    app.get('/reliability', requireSignature, (_req, res) => {
        const queueMetrics = deps.dispatcher?.queue.getStats() ?? null;
        const callbackCounts = getCallbackOutcomeCounts();
        const callbackMetrics = {
            totalAccepted: callbackCounts.accepted,
            totalDuplicate: callbackCounts.duplicate,
            totalRejected: callbackCounts.rejected,
        };

        sendOk(res, {
            queue: queueMetrics,
            callbacks: callbackMetrics
        });
    });
    app.get('/budget/state', requireSignature, (req, res) => {
        if (!deps.budgetGovernor) {
            sendError(res, 'Runtime budget governor not initialized.', 503);
            return;
        }

        const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
        sendOk(res, deps.budgetGovernor.getSnapshot(sessionId));
    });
    app.get('/budget/events', requireSignature, (req, res) => {
        if (!deps.budgetGovernor) {
            sendError(res, 'Runtime budget governor not initialized.', 503);
            return;
        }

        const requestedLimit = Number(req.query.limit ?? 100);
        const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
            ? Math.min(500, Math.floor(requestedLimit))
            : 100;
        sendOk(res, { events: deps.budgetGovernor.getRecentEvents(limit) });
    });
    app.post('/budget/profile', requireSignature, (req, res) => {
        if (!deps.budgetGovernor) {
            sendError(res, 'Runtime budget governor not initialized.', 503);
            return;
        }

        const rawProfile = req.body?.profile;
        if (rawProfile !== null && rawProfile !== undefined && typeof rawProfile !== 'string') {
            sendError(res, 'Invalid profile. Expected one of: economy, balanced, performance, null.', 400);
            return;
        }

        if (typeof rawProfile === 'string' && !['economy', 'balanced', 'performance'].includes(rawProfile)) {
            sendError(res, 'Invalid profile. Expected one of: economy, balanced, performance, null.', 400);
            return;
        }

        const profile = typeof rawProfile === 'string'
            ? (rawProfile as 'economy' | 'balanced' | 'performance')
            : null;
        deps.budgetGovernor.setManualProfile(profile, typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined);
        sendOk(res, {
            message: profile
                ? `Manual budget profile set to '${profile}'.`
                : 'Manual budget profile override cleared.',
            snapshot: deps.budgetGovernor.getSnapshot(typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined),
        });
    });
    app.post('/budget/reset', requireSignature, (req, res) => {
        if (!deps.budgetGovernor) {
            sendError(res, 'Runtime budget governor not initialized.', 503);
            return;
        }

        const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
        deps.budgetGovernor.resetPolicyState(sessionId);
        sendOk(res, {
            message: 'Runtime budget policy state reset.',
            snapshot: deps.budgetGovernor.getSnapshot(sessionId),
        });
    });
    app.get('/routing/telemetry', requireSignature, (_req, res) => {
        if (!deps.modelRouter) {
            sendError(res, 'Model router not initialized.', 503);
            return;
        }
        sendOk(res, deps.modelRouter.getHealthSnapshot());
    });
    app.post('/routing/mode', requireSignature, (req, res) => {
        if (!deps.modelRouter) {
            sendError(res, 'Model router not initialized.', 503);
            return;
        }

        const mode = req.body?.mode;
        if (typeof mode !== 'string' || !['intelligent_pacing', 'aggressive_fallback'].includes(mode)) {
            sendError(res, 'Invalid mode. Expected one of: intelligent_pacing, aggressive_fallback.', 400);
            return;
        }

        const snapshot = deps.modelRouter.setFallbackMode(mode as 'intelligent_pacing' | 'aggressive_fallback');
        sendOk(res, {
            message: `Routing fallback mode set to '${mode}'.`,
            snapshot,
        });
    });

    app.get('/logs', requireSignature, async (_req, res) => {
        try {
            const dateIso = new Date().toISOString().slice(0, 10);
            const logPath = path.resolve('memory', `${dateIso}.md`);
            const content = await readFile(logPath, 'utf8').catch(() => 'No logs found for today.');

            // Simple parsing to turn markdown into a list of "entries"
            // Entries are separated by ## title @ timestamp
            const sections = content.split(/\n## /).filter(Boolean);
            const entries = sections.map(s => {
                const [header, ...bodyLines] = s.split('\n');
                const [type, timestamp] = header.split(' @ ');
                return {
                    timestamp: timestamp || new Date().toISOString(),
                    level: type.toUpperCase(),
                    message: bodyLines.join('\n').trim()
                };
            }).reverse().slice(0, 100); // Return last 100 entries

            sendOk(res, entries);
        } catch (err) {
            sendError(res, 'Failed to read logs.', 500);
        }
    });

    app.post('/reliability/replay/:id', requireSignature, (_req, res) => {
        const id = _req.params.id;
        if (typeof id !== 'string') {
            sendError(res, 'Invalid ID', 400);
            return;
        }
        if (!deps.dispatcher) {
            sendError(res, 'Dispatcher not active.', 500);
            return;
        }
        try {
            deps.dispatcher.queue.requeueDeadLetter(id);
            sendOk(res, { message: `Queued replay for message ${id}` });
        } catch (err) {
            sendError(res, `Failed to requeue: ${err instanceof Error ? err.message : String(err)}`, 500);
        }
    });
    app.get('/incidents/current', requireSignature, (_req, res) => {
        if (!deps.incidentManager) {
            sendError(res, 'Incident manager not initialized.', 503);
            return;
        }

        sendOk(res, {
            safeMode: deps.incidentManager.isSafeModeEnabled(),
            incidents: deps.incidentManager.getCurrentIncidents(),
        });
    });
    app.get('/incidents/history', requireSignature, (req, res) => {
        if (!deps.incidentManager) {
            sendError(res, 'Incident manager not initialized.', 503);
            return;
        }

        const requestedLimit = Number(req.query.limit ?? 200);
        const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
            ? Math.min(500, Math.floor(requestedLimit))
            : 200;

        sendOk(res, {
            incidents: deps.incidentManager.getIncidentHistory(limit),
            timeline: deps.incidentManager.getIncidentTimeline(limit),
        });
    });
    app.post('/incidents/evaluate', requireSignature, (_req, res) => {
        if (!deps.incidentManager) {
            sendError(res, 'Incident manager not initialized.', 503);
            return;
        }

        const incidents = deps.incidentManager.evaluateNow();
        sendOk(res, {
            safeMode: deps.incidentManager.isSafeModeEnabled(),
            incidents,
        });
    });
    app.get('/persona/state', requireSignature, handlePersonaStateGet(personaStateDeps));
    app.put('/persona/state', requireSignature, handlePersonaStateUpdate(personaStateDeps));
    app.post('/browser/snapshot', requireSignature, handleBrowserSnapshot(browserDeps));
    app.post('/browser/click', requireSignature, handleBrowserClick(browserDeps));
    app.post('/callback/webhook', requireSignature, handleWebhookCallback(callbackDeps));

    app.post('/system/halt', requireSignature, (_req, res) => {
        void logThought('[API] Received /system/halt request from Control Plane GUI. Halting node process.');
        sendOk(res, { message: 'Agent halting...' });
        // Give the response a moment to flush before killing process
        setTimeout(() => process.exit(0), 500);
    });

    app.get('/ws/metrics', requireSignature, (_req, res) => {
        if (!deps.wsHub) {
            sendError(res, 'WebSocket hub not initialized.', 503);
            return;
        }
        sendOk(res, deps.wsHub.getMetrics());
    });

    // ── Catch-all 404 ──────────────────────────────────────────────────────────
    app.use((_req, res) => {
        sendError(res, 'Not found.', 404);
    });

    // ── Start ──────────────────────────────────────────────────────────────────
    server.listen(port, () => {
        console.log(`[TwinClaw API] Control plane listening on http://localhost:${port}`);
        void logThought(`[API] HTTP server started on port ${port}.`);
    });
}
