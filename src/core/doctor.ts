import type { HealthCheckResult, DoctorReport, ReadinessSummary, ReadinessLevel } from '../types/health-doctor.js';
import type { HeartbeatService } from './heartbeat.js';
import type { SkillRegistry } from '../services/skill-registry.js';
import type { McpServerManager } from '../services/mcp-server-manager.js';
import type { QueueService } from '../services/queue-service.js';
import type { ModelRouter } from '../services/model-router.js';
import type { IncidentManager } from '../services/incident-manager.js';
import { getSecretVaultService } from '../services/secret-vault.js';
import { db } from '../services/db.js';

export interface DoctorDeps {
    heartbeat?: HeartbeatService;
    skillRegistry?: SkillRegistry;
    mcpManager?: McpServerManager;
    queue?: QueueService;
    modelRouter?: ModelRouter;
    incidentManager?: IncidentManager;
}

/**
 * Modular runtime health doctor.
 *
 * Runs deterministic checks covering config validity, DB availability,
 * queue state, interface adapters, secret vault, MCP servers, and
 * model routing. Produces a {@link DoctorReport} with actionable
 * remediation guidance for every failing check.
 *
 * All diagnostic output is redaction-safe — no secret values are emitted.
 */
export class DoctorService {
    readonly #deps: DoctorDeps;

    constructor(deps: DoctorDeps = {}) {
        this.#deps = deps;
    }

    /** Run all applicable checks and return the full doctor report. */
    async runAll(): Promise<DoctorReport> {
        const checks: HealthCheckResult[] = await Promise.all([
            checkDbAvailability(),
            checkConfigReadiness(),
            checkSecretVault(),
            this.#deps.heartbeat ? checkHeartbeat(this.#deps.heartbeat) : null,
            this.#deps.skillRegistry ? checkSkillRegistry(this.#deps.skillRegistry) : null,
            this.#deps.mcpManager ? checkMcpServers(this.#deps.mcpManager) : null,
            this.#deps.queue ? checkQueueState(this.#deps.queue) : null,
            this.#deps.modelRouter ? checkModelRouter(this.#deps.modelRouter) : null,
            this.#deps.incidentManager ? checkIncidents(this.#deps.incidentManager) : null,
        ]).then((results) => results.filter((r): r is HealthCheckResult => r !== null));

        return buildReport(checks);
    }
}

// ── Individual Checks ────────────────────────────────────────────────────────

/** Check that the SQLite database is reachable with a trivial query. */
function checkDbAvailability(): HealthCheckResult {
    try {
        db.prepare('SELECT 1').get();
        return {
            id: 'db_availability',
            name: 'Database Availability',
            severity: 'ok',
            message: 'SQLite database is reachable.',
        };
    } catch (err) {
        return {
            id: 'db_availability',
            name: 'Database Availability',
            severity: 'critical',
            message: `SQLite database query failed: ${safeError(err)}`,
            remediation:
                'Ensure the memory/ directory is writable and no other process has an exclusive lock on twinclaw.db.',
        };
    }
}

/** Check that required environment variables and runtime config are present. */
function checkConfigReadiness(): HealthCheckResult {
    const required = ['API_SECRET'];
    const missing = required.filter((k) => !process.env[k]);

    if (missing.length > 0) {
        return {
            id: 'config_readiness',
            name: 'Configuration Readiness',
            severity: 'critical',
            message: `Missing required environment variable(s): ${missing.join(', ')}.`,
            remediation:
                'Copy .env.example to .env and set all required values. ' +
                'Run `secret set <NAME> <VALUE>` for sensitive secrets.',
        };
    }

    const warnings: string[] = [];
    const optionalChecks: Array<[string, string]> = [
        ['TELEGRAM_BOT_TOKEN', 'Telegram messaging unavailable'],
        ['GROQ_API_KEY', 'Voice (STT/TTS) unavailable'],
        ['OPENROUTER_API_KEY', 'OpenRouter model provider unavailable'],
    ];
    for (const [key, label] of optionalChecks) {
        if (!process.env[key]) {
            warnings.push(`${key} not set — ${label}`);
        }
    }

    if (warnings.length > 0) {
        return {
            id: 'config_readiness',
            name: 'Configuration Readiness',
            severity: 'warning',
            message: `Optional config missing: ${warnings.join('; ')}.`,
            remediation:
                'Set the missing environment variables to enable full functionality. ' +
                'See .env.example for reference.',
        };
    }

    return {
        id: 'config_readiness',
        name: 'Configuration Readiness',
        severity: 'ok',
        message: 'All required configuration is present.',
    };
}

/** Check the secret vault for missing required secrets or expired values. */
function checkSecretVault(): HealthCheckResult {
    try {
        const diagnostics = getSecretVaultService().getDiagnostics(['API_SECRET']);
        const { health } = diagnostics;

        if (health.missingRequired.length > 0) {
            return {
                id: 'secret_vault',
                name: 'Secret Vault',
                severity: 'critical',
                message: `Missing required secret(s): ${health.missingRequired.join(', ')}.`,
                remediation:
                    'Run `secret set <NAME> <VALUE> --required` to register missing secrets. ' +
                    'Ensure API_SECRET is set for control-plane authentication.',
            };
        }

        if (health.hasIssues) {
            const issues: string[] = [];
            if (health.expired.length > 0) {
                issues.push(`expired: ${health.expired.join(', ')}`);
            }
            if (health.warnings.length > 0) {
                issues.push(...health.warnings.slice(0, 3));
            }

            return {
                id: 'secret_vault',
                name: 'Secret Vault',
                severity: 'warning',
                message: `Secret vault issues detected: ${issues.join('; ')}.`,
                remediation:
                    'Run `secret doctor` for a full secret vault report. ' +
                    'Use `secret rotate <NAME> <VALUE>` to refresh expired or due-for-rotation secrets.',
            };
        }

        return {
            id: 'secret_vault',
            name: 'Secret Vault',
            severity: 'ok',
            message: `Secret vault healthy (${diagnostics.active} active, ${diagnostics.dueForRotation.length} due for rotation).`,
        };
    } catch (err) {
        return {
            id: 'secret_vault',
            name: 'Secret Vault',
            severity: 'warning',
            message: `Secret vault check failed: ${safeError(err)}`,
            remediation: 'Verify the secret vault service is initialized. Run `secret list` to inspect state.',
        };
    }
}

/** Check that the heartbeat scheduler is running and has active jobs. */
function checkHeartbeat(heartbeat: HeartbeatService): HealthCheckResult {
    const jobs = heartbeat.scheduler.listJobs();
    const running = jobs.filter((j) => j.status === 'running');

    if (running.length === 0) {
        return {
            id: 'heartbeat_scheduler',
            name: 'Heartbeat & Scheduler',
            severity: 'warning',
            message: `Scheduler has no running jobs (${jobs.length} registered, 0 running).`,
            remediation:
                'Check that heartbeat.start() was called during initialization and no errors interrupted scheduler startup.',
        };
    }

    return {
        id: 'heartbeat_scheduler',
        name: 'Heartbeat & Scheduler',
        severity: 'ok',
        message: `Scheduler healthy: ${running.length}/${jobs.length} jobs running.`,
    };
}

/** Check skill registry population. */
function checkSkillRegistry(registry: SkillRegistry): HealthCheckResult {
    const summary = registry.summary();
    const total = registry.size;

    if (total === 0) {
        return {
            id: 'skill_registry',
            name: 'Skill Registry',
            severity: 'warning',
            message: 'No skills registered — builtin skill loading may have failed.',
            remediation:
                'Ensure createBuiltinSkills() is called before startApiServer(). Check startup logs for skill registration errors.',
        };
    }

    return {
        id: 'skill_registry',
        name: 'Skill Registry',
        severity: 'ok',
        message: `${total} skill(s) registered (${summary.builtin ?? 0} builtin, ${summary.mcp ?? 0} MCP).`,
    };
}

/** Check MCP server connectivity status. */
async function checkMcpServers(mcpManager: McpServerManager): Promise<HealthCheckResult> {
    const servers = mcpManager.listServers();
    if (servers.length === 0) {
        return {
            id: 'mcp_servers',
            name: 'MCP Servers',
            severity: 'ok',
            message: 'No MCP servers configured.',
        };
    }

    const errorServers = servers.filter((s) => s.state === 'error');
    const connectedServers = servers.filter((s) => s.state === 'connected');

    if (errorServers.length === servers.length) {
        return {
            id: 'mcp_servers',
            name: 'MCP Servers',
            severity: 'critical',
            message: `All ${servers.length} MCP server(s) are in error state.`,
            remediation:
                'Check mcp-servers.json for correct server configuration. Verify server processes are running and accessible.',
        };
    }

    if (errorServers.length > 0) {
        return {
            id: 'mcp_servers',
            name: 'MCP Servers',
            severity: 'warning',
            message:
                `${errorServers.length}/${servers.length} MCP server(s) in error state. ` +
                `Connected: ${connectedServers.length}.`,
            remediation:
                `Failing server(s): ${errorServers.map((s) => s.name).join(', ')}. ` +
                'Check their configuration and restart if needed.',
        };
    }

    return {
        id: 'mcp_servers',
        name: 'MCP Servers',
        severity: 'ok',
        message: `${connectedServers.length}/${servers.length} MCP server(s) connected.`,
    };
}

/** Check delivery queue state for backpressure or dead letters. */
function checkQueueState(queue: QueueService): HealthCheckResult {
    try {
        const stats = queue.getStats();
        const deadLetters = Number(stats.totalDeadLetters ?? 0);
        const failed = Number(stats.totalFailed ?? 0);
        const queued = Number(stats.totalQueued ?? 0) + Number(stats.totalDispatching ?? 0);
        const controls = queue.getRuntimeControls();

        if (deadLetters > 0) {
            return {
                id: 'queue_state',
                name: 'Delivery Queue',
                severity: 'warning',
                message:
                    `Delivery queue has ${deadLetters} dead-letter(s), ${failed} failed, ${queued} pending. ` +
                    `Mode: ${controls.mode}.`,
                remediation:
                    'Use POST /reliability/replay/:id to replay specific dead-letter entries. ' +
                    'Inspect logs to identify the root cause of delivery failures.',
            };
        }

        if (failed > 10 || queued > 25) {
            return {
                id: 'queue_state',
                name: 'Delivery Queue',
                severity: 'warning',
                message: `Queue backpressure detected: ${queued} pending, ${failed} failed. Mode: ${controls.mode}.`,
                remediation:
                    'Monitor queue growth. If backpressure persists, check outbound adapter connectivity (Telegram/WhatsApp).',
            };
        }

        return {
            id: 'queue_state',
            name: 'Delivery Queue',
            severity: 'ok',
            message: `Delivery queue healthy: ${queued} pending, ${failed} failed, ${deadLetters} dead-letter(s). Mode: ${controls.mode}.`,
        };
    } catch (err) {
        return {
            id: 'queue_state',
            name: 'Delivery Queue',
            severity: 'warning',
            message: `Queue state check failed: ${safeError(err)}`,
            remediation: 'Verify the queue service is started and the database is accessible.',
        };
    }
}

/** Check model router health for routing instability. */
function checkModelRouter(modelRouter: ModelRouter): HealthCheckResult {
    try {
        const snapshot = modelRouter.getHealthSnapshot();
        const { consecutiveFailures, failoverCount, currentModelName } = snapshot;

        if (consecutiveFailures >= 3) {
            return {
                id: 'model_router',
                name: 'Model Router',
                severity: 'critical',
                message:
                    `Model router has ${consecutiveFailures} consecutive failure(s). ` +
                    `Current model: ${currentModelName ?? 'unknown'}. Last error: ${snapshot.lastError ?? 'none'}.`,
                remediation:
                    'Verify upstream model provider credentials and quotas in environment variables. ' +
                    'Use POST /routing/mode to switch fallback mode or POST /routing/mode with aggressive_fallback.',
            };
        }

        if (consecutiveFailures > 0 || failoverCount > 0) {
            return {
                id: 'model_router',
                name: 'Model Router',
                severity: 'warning',
                message:
                    `Model router has recovered but shows instability: ${consecutiveFailures} consecutive failure(s), ` +
                    `${failoverCount} failover(s). Current model: ${currentModelName ?? 'unknown'}.`,
                remediation:
                    'Monitor model routing telemetry at GET /routing/telemetry. ' +
                    'Consider pinning a stable provider temporarily.',
            };
        }

        return {
            id: 'model_router',
            name: 'Model Router',
            severity: 'ok',
            message: `Model router healthy. Current model: ${currentModelName ?? 'unknown'}.`,
        };
    } catch (err) {
        return {
            id: 'model_router',
            name: 'Model Router',
            severity: 'warning',
            message: `Model router check failed: ${safeError(err)}`,
            remediation: 'Verify the model router is initialized. Check GET /routing/telemetry for details.',
        };
    }
}

/** Check the incident manager for active or escalated incidents. */
function checkIncidents(incidentManager: IncidentManager): HealthCheckResult {
    try {
        const current = incidentManager.getCurrentIncidents();
        const escalated = current.filter((i) => i.status === 'escalated');
        const active = current.filter((i) => i.status === 'active' || i.status === 'remediating');

        if (escalated.length > 0) {
            return {
                id: 'incident_manager',
                name: 'Incident Manager',
                severity: 'critical',
                message:
                    `${escalated.length} escalated incident(s) require operator intervention: ` +
                    `${escalated.map((i) => i.incidentType).join(', ')}.`,
                remediation:
                    'Review GET /incidents/current for full incident details and recommended actions. ' +
                    'Address underlying cause and restart affected services.',
            };
        }

        if (active.length > 0) {
            return {
                id: 'incident_manager',
                name: 'Incident Manager',
                severity: 'warning',
                message: `${active.length} active incident(s) under self-healing: ${active.map((i) => i.incidentType).join(', ')}.`,
                remediation:
                    'Self-healing playbooks are running. Review GET /incidents/current for remediation progress.',
            };
        }

        return {
            id: 'incident_manager',
            name: 'Incident Manager',
            severity: 'ok',
            message: 'No active incidents.',
        };
    } catch (err) {
        return {
            id: 'incident_manager',
            name: 'Incident Manager',
            severity: 'warning',
            message: `Incident manager check failed: ${safeError(err)}`,
            remediation: 'Verify the incident manager is initialized at startup.',
        };
    }
}

// ── Report Assembly ─────────────────────────────────────────────────────────

function buildReport(checks: HealthCheckResult[]): DoctorReport {
    const critical = checks.filter((c) => c.severity === 'critical').length;
    const warnings = checks.filter((c) => c.severity === 'warning').length;
    const passed = checks.filter((c) => c.severity === 'ok').length;

    let level: ReadinessLevel;
    if (critical > 0) {
        level = 'not_ready';
    } else if (warnings > 0) {
        level = 'degraded';
    } else {
        level = 'ready';
    }

    const readiness: ReadinessSummary = {
        level,
        totalChecks: checks.length,
        passed,
        warnings,
        critical,
        evaluatedAt: new Date().toISOString(),
    };

    return { readiness, checks };
}

// ── Utilities ────────────────────────────────────────────────────────────────

function safeError(err: unknown): string {
    if (err instanceof Error) {
        // Strip any file paths or stack frames — keep message only
        return err.message.split('\n')[0] ?? 'unknown error';
    }
    return String(err).split('\n')[0] ?? 'unknown error';
}
