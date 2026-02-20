import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DoctorService } from '../../src/core/doctor.js';

// ── DB mock ─────────────────────────────────────────────────────────────────
vi.mock('../../src/services/db.js', () => ({
    db: {
        prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(1) }),
    },
}));

// ── Secret vault mock ────────────────────────────────────────────────────────
const mockGetDiagnostics = vi.fn();
vi.mock('../../src/services/secret-vault.js', () => ({
    getSecretVaultService: () => ({
        getDiagnostics: mockGetDiagnostics,
    }),
}));

// ── Logger mock ──────────────────────────────────────────────────────────────
vi.mock('../../src/utils/logger.js', () => ({
    logThought: vi.fn(),
    scrubSensitiveText: vi.fn((t: string) => t),
}));

function healthySecretDiagnostics() {
    return {
        health: { hasIssues: false, missingRequired: [], expired: [], warnings: [] },
        total: 2,
        active: 2,
        dueForRotation: [],
        revoked: 0,
        expired: 0,
    };
}

function buildMockHeartbeat(runningJobs = 1) {
    return {
        scheduler: {
            listJobs: vi.fn().mockReturnValue(
                Array.from({ length: runningJobs }, () => ({ status: 'running' })),
            ),
        },
    } as any;
}

function buildMockSkillRegistry(total = 3) {
    return {
        summary: vi.fn().mockReturnValue({ builtin: total, mcp: 0 }),
        size: total,
    } as any;
}

function buildMockMcpManager(servers: Array<{ name: string; state: string }> = []) {
    return {
        listServers: vi.fn().mockReturnValue(servers),
    } as any;
}

function buildMockQueue(
    opts: { deadLetters?: number; failed?: number; queued?: number; mode?: string } = {},
) {
    const { deadLetters = 0, failed = 0, queued = 0, mode = 'normal' } = opts;
    return {
        getStats: vi.fn().mockReturnValue({
            totalDeadLetters: deadLetters,
            totalFailed: failed,
            totalQueued: queued,
            totalDispatching: 0,
        }),
        getRuntimeControls: vi.fn().mockReturnValue({ mode }),
    } as any;
}

function buildMockModelRouter(consecutiveFailures = 0, failoverCount = 0, currentModelName = 'gpt-4o') {
    return {
        getHealthSnapshot: vi.fn().mockReturnValue({
            consecutiveFailures,
            failoverCount,
            currentModelName,
            lastError: consecutiveFailures > 0 ? '429 Too Many Requests' : null,
        }),
    } as any;
}

function buildMockIncidentManager(incidents: Array<{ status: string; incidentType: string }> = []) {
    return {
        getCurrentIncidents: vi.fn().mockReturnValue(incidents),
    } as any;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('DoctorService', () => {
    beforeEach(() => {
        mockGetDiagnostics.mockReturnValue(healthySecretDiagnostics());
        // Set required and optional env vars so all checks pass in healthy tests
        process.env.API_SECRET = 'test-secret';
        process.env.TELEGRAM_BOT_TOKEN = 'tg-test-token';
        process.env.GROQ_API_KEY = 'groq-test-key';
        process.env.OPENROUTER_API_KEY = 'or-test-key';
    });

    describe('healthy path', () => {
        it('returns ready level when all checks pass', async () => {
            const doctor = new DoctorService({
                heartbeat: buildMockHeartbeat(),
                skillRegistry: buildMockSkillRegistry(),
                mcpManager: buildMockMcpManager([{ name: 'tools', state: 'connected' }]),
                queue: buildMockQueue(),
                modelRouter: buildMockModelRouter(),
                incidentManager: buildMockIncidentManager(),
            });

            const report = await doctor.runAll();

            expect(report.readiness.level).toBe('ready');
            expect(report.readiness.critical).toBe(0);
            expect(report.readiness.warnings).toBe(0);
            expect(report.readiness.passed).toBe(report.readiness.totalChecks);
            expect(report.checks.every((c) => c.severity === 'ok')).toBe(true);
        });

        it('includes all expected check IDs', async () => {
            const doctor = new DoctorService({
                heartbeat: buildMockHeartbeat(),
                skillRegistry: buildMockSkillRegistry(),
                mcpManager: buildMockMcpManager(),
                queue: buildMockQueue(),
                modelRouter: buildMockModelRouter(),
                incidentManager: buildMockIncidentManager(),
            });

            const report = await doctor.runAll();
            const ids = report.checks.map((c) => c.id);

            expect(ids).toContain('db_availability');
            expect(ids).toContain('config_readiness');
            expect(ids).toContain('secret_vault');
            expect(ids).toContain('heartbeat_scheduler');
            expect(ids).toContain('skill_registry');
            expect(ids).toContain('mcp_servers');
            expect(ids).toContain('queue_state');
            expect(ids).toContain('model_router');
            expect(ids).toContain('incident_manager');
        });

        it('omits optional checks when deps are not provided', async () => {
            const doctor = new DoctorService(); // no deps
            const report = await doctor.runAll();

            const ids = report.checks.map((c) => c.id);
            expect(ids).toContain('db_availability');
            expect(ids).toContain('config_readiness');
            expect(ids).toContain('secret_vault');
            // Optional checks omitted
            expect(ids).not.toContain('heartbeat_scheduler');
            expect(ids).not.toContain('skill_registry');
            expect(ids).not.toContain('queue_state');
            expect(ids).not.toContain('model_router');
            expect(ids).not.toContain('incident_manager');
        });
    });

    describe('degraded path', () => {
        it('returns degraded when optional env vars are missing', async () => {
            delete process.env.TELEGRAM_BOT_TOKEN;
            delete process.env.GROQ_API_KEY;
            delete process.env.OPENROUTER_API_KEY;

            const doctor = new DoctorService();
            const report = await doctor.runAll();

            const configCheck = report.checks.find((c) => c.id === 'config_readiness');
            expect(configCheck?.severity).toBe('warning');
            expect(report.readiness.level).toBe('degraded');
            expect(report.readiness.warnings).toBeGreaterThan(0);
        });

        it('returns degraded when secret vault has warnings', async () => {
            mockGetDiagnostics.mockReturnValue({
                health: {
                    hasIssues: true,
                    missingRequired: [],
                    expired: ['OLD_TOKEN'],
                    warnings: ['OLD_TOKEN due for rotation'],
                },
                total: 2,
                active: 1,
                dueForRotation: ['OLD_TOKEN'],
                revoked: 0,
                expired: 1,
            });

            const doctor = new DoctorService();
            const report = await doctor.runAll();

            const secretCheck = report.checks.find((c) => c.id === 'secret_vault');
            expect(secretCheck?.severity).toBe('warning');
            expect(secretCheck?.remediation).toBeDefined();
        });

        it('returns degraded when scheduler has no running jobs', async () => {
            const doctor = new DoctorService({
                heartbeat: buildMockHeartbeat(0), // 0 running jobs
            });

            const report = await doctor.runAll();
            const check = report.checks.find((c) => c.id === 'heartbeat_scheduler');
            expect(check?.severity).toBe('warning');
            expect(report.readiness.level).toBe('degraded');
        });

        it('returns degraded on partial MCP server failures', async () => {
            const doctor = new DoctorService({
                mcpManager: buildMockMcpManager([
                    { name: 'tools-a', state: 'connected' },
                    { name: 'tools-b', state: 'error' },
                ]),
            });

            const report = await doctor.runAll();
            const check = report.checks.find((c) => c.id === 'mcp_servers');
            expect(check?.severity).toBe('warning');
            expect(check?.remediation).toContain('tools-b');
        });

        it('returns degraded when queue has dead letters', async () => {
            const doctor = new DoctorService({
                queue: buildMockQueue({ deadLetters: 3 }),
            });

            const report = await doctor.runAll();
            const check = report.checks.find((c) => c.id === 'queue_state');
            expect(check?.severity).toBe('warning');
            expect(check?.remediation).toContain('replay');
        });

        it('returns degraded on mild model routing instability', async () => {
            const doctor = new DoctorService({
                modelRouter: buildMockModelRouter(1, 2), // 1 consecutive failure, 2 failovers
            });

            const report = await doctor.runAll();
            const check = report.checks.find((c) => c.id === 'model_router');
            expect(check?.severity).toBe('warning');
        });

        it('returns degraded with active but remediating incident', async () => {
            const doctor = new DoctorService({
                incidentManager: buildMockIncidentManager([
                    { status: 'remediating', incidentType: 'queue_backpressure' },
                ]),
            });

            const report = await doctor.runAll();
            const check = report.checks.find((c) => c.id === 'incident_manager');
            expect(check?.severity).toBe('warning');
        });
    });

    describe('hard-fail (not_ready) path', () => {
        it('returns not_ready when required env var is missing', async () => {
            delete process.env.API_SECRET;

            const doctor = new DoctorService();
            const report = await doctor.runAll();

            const configCheck = report.checks.find((c) => c.id === 'config_readiness');
            expect(configCheck?.severity).toBe('critical');
            expect(report.readiness.level).toBe('not_ready');
            expect(report.readiness.critical).toBeGreaterThan(0);
        });

        it('returns not_ready when secret vault has missing required secrets', async () => {
            mockGetDiagnostics.mockReturnValue({
                health: {
                    hasIssues: true,
                    missingRequired: ['API_SECRET'],
                    expired: [],
                    warnings: [],
                },
                total: 0,
                active: 0,
                dueForRotation: [],
                revoked: 0,
                expired: 0,
            });

            const doctor = new DoctorService();
            const report = await doctor.runAll();

            const check = report.checks.find((c) => c.id === 'secret_vault');
            expect(check?.severity).toBe('critical');
            expect(check?.remediation).toBeDefined();
            expect(report.readiness.level).toBe('not_ready');
        });

        it('returns not_ready when all MCP servers fail', async () => {
            const doctor = new DoctorService({
                mcpManager: buildMockMcpManager([
                    { name: 'tools-a', state: 'error' },
                    { name: 'tools-b', state: 'error' },
                ]),
            });

            const report = await doctor.runAll();
            const check = report.checks.find((c) => c.id === 'mcp_servers');
            expect(check?.severity).toBe('critical');
            expect(report.readiness.level).toBe('not_ready');
        });

        it('returns not_ready when model router has >=3 consecutive failures', async () => {
            const doctor = new DoctorService({
                modelRouter: buildMockModelRouter(3),
            });

            const report = await doctor.runAll();
            const check = report.checks.find((c) => c.id === 'model_router');
            expect(check?.severity).toBe('critical');
            expect(report.readiness.level).toBe('not_ready');
        });

        it('returns not_ready on escalated incident', async () => {
            const doctor = new DoctorService({
                incidentManager: buildMockIncidentManager([
                    { status: 'escalated', incidentType: 'model_routing_instability' },
                ]),
            });

            const report = await doctor.runAll();
            const check = report.checks.find((c) => c.id === 'incident_manager');
            expect(check?.severity).toBe('critical');
            expect(check?.remediation).toBeDefined();
            expect(report.readiness.level).toBe('not_ready');
        });
    });

    describe('remediation guidance', () => {
        it('provides remediation for every non-ok check', async () => {
            delete process.env.API_SECRET;
            mockGetDiagnostics.mockReturnValue({
                health: {
                    hasIssues: true,
                    missingRequired: ['API_SECRET'],
                    expired: [],
                    warnings: [],
                },
                total: 0,
                active: 0,
                dueForRotation: [],
                revoked: 0,
                expired: 0,
            });

            const doctor = new DoctorService({
                mcpManager: buildMockMcpManager([{ name: 'tools', state: 'error' }]),
                modelRouter: buildMockModelRouter(5),
                incidentManager: buildMockIncidentManager([
                    { status: 'escalated', incidentType: 'queue_backpressure' },
                ]),
            });

            const report = await doctor.runAll();
            const nonOkChecks = report.checks.filter((c) => c.severity !== 'ok');

            for (const check of nonOkChecks) {
                expect(check.remediation, `Missing remediation for check: ${check.id}`).toBeTruthy();
            }
        });

        it('all diagnostics are redaction-safe (no raw secrets in output)', async () => {
            process.env.API_SECRET = 'super-secret-value-12345';

            const doctor = new DoctorService();
            const report = await doctor.runAll();
            const serialized = JSON.stringify(report);

            expect(serialized).not.toContain('super-secret-value-12345');
        });
    });

    describe('readiness summary', () => {
        it('has correct evaluatedAt timestamp format', async () => {
            const before = Date.now();
            const doctor = new DoctorService();
            const report = await doctor.runAll();
            const after = Date.now();

            const ts = new Date(report.readiness.evaluatedAt).getTime();
            expect(ts).toBeGreaterThanOrEqual(before);
            expect(ts).toBeLessThanOrEqual(after);
        });

        it('passed + warnings + critical = totalChecks', async () => {
            const doctor = new DoctorService({
                heartbeat: buildMockHeartbeat(),
                skillRegistry: buildMockSkillRegistry(),
                mcpManager: buildMockMcpManager(),
                queue: buildMockQueue({ deadLetters: 2 }),
                modelRouter: buildMockModelRouter(3),
                incidentManager: buildMockIncidentManager(),
            });

            const report = await doctor.runAll();
            const { totalChecks, passed, warnings, critical } = report.readiness;

            expect(passed + warnings + critical).toBe(totalChecks);
        });
    });
});
