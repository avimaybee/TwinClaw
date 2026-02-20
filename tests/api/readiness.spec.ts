import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { handleReadiness, handleDoctor } from '../../src/api/handlers/readiness.js';

// ── DB mock ──────────────────────────────────────────────────────────────────
vi.mock('../../src/services/db.js', () => ({
    db: {
        prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(1) }),
    },
}));

// ── Secret vault mock ─────────────────────────────────────────────────────────
const mockGetDiagnostics = vi.fn();
vi.mock('../../src/services/secret-vault.js', () => ({
    getSecretVaultService: () => ({
        getDiagnostics: mockGetDiagnostics,
    }),
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock('../../src/utils/logger.js', () => ({
    logThought: vi.fn(),
    scrubSensitiveText: vi.fn((t: string) => t),
}));

function healthySecretDiagnostics() {
    return {
        health: { hasIssues: false, missingRequired: [], expired: [], warnings: [] },
        total: 1,
        active: 1,
        dueForRotation: [],
        revoked: 0,
        expired: 0,
    };
}

describe('GET /readiness', () => {
    let app: Express;
    let previousApiSecret: string | undefined;

    beforeEach(() => {
        previousApiSecret = process.env.API_SECRET;
        process.env.API_SECRET = 'readiness-test-secret';
        // Also set optional vars so healthy state is fully ok
        process.env.TELEGRAM_BOT_TOKEN = 'tg-test-token';
        process.env.GROQ_API_KEY = 'groq-test-key';
        process.env.OPENROUTER_API_KEY = 'or-test-key';
        mockGetDiagnostics.mockReturnValue(healthySecretDiagnostics());

        app = express();
        app.use(express.json());
    });

    afterEach(() => {
        if (previousApiSecret === undefined) {
            delete process.env.API_SECRET;
        } else {
            process.env.API_SECRET = previousApiSecret;
        }
    });

    it('returns 200 and ready when all checks pass', async () => {
        app.get('/readiness', handleReadiness({}));
        const response = await request(app).get('/readiness');

        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(true);
        expect(response.body.data.level).toBe('ready');
        expect(response.body.data.evaluatedAt).toBeTruthy();
        expect(typeof response.body.data.passed).toBe('number');
        expect(typeof response.body.data.warnings).toBe('number');
        expect(typeof response.body.data.critical).toBe('number');
    });

    it('returns 200 and degraded when optional env vars missing', async () => {
        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.GROQ_API_KEY;
        delete process.env.OPENROUTER_API_KEY;

        app.get('/readiness', handleReadiness({}));
        const response = await request(app).get('/readiness');

        expect(response.status).toBe(200);
        expect(response.body.data.level).toBe('degraded');
        expect(response.body.data.warnings).toBeGreaterThan(0);
    });

    it('returns 503 and not_ready when required config is missing', async () => {
        delete process.env.API_SECRET;

        app.get('/readiness', handleReadiness({}));
        const response = await request(app).get('/readiness');

        expect(response.status).toBe(503);
        expect(response.body.ok).toBe(true); // envelope ok=true, HTTP 503
        expect(response.body.data.level).toBe('not_ready');
        expect(response.body.data.critical).toBeGreaterThan(0);
    });

    it('returns 503 when model router has critical failures', async () => {
        const mockModelRouter = {
            getHealthSnapshot: vi.fn().mockReturnValue({
                consecutiveFailures: 5,
                failoverCount: 3,
                currentModelName: 'fallback-model',
                lastError: 'HTTP 500',
            }),
        } as any;

        app.get('/readiness', handleReadiness({ modelRouter: mockModelRouter }));
        const response = await request(app).get('/readiness');

        expect(response.status).toBe(503);
        expect(response.body.data.level).toBe('not_ready');
    });
});

describe('GET /doctor', () => {
    let app: Express;
    let previousApiSecret: string | undefined;

    beforeEach(() => {
        previousApiSecret = process.env.API_SECRET;
        process.env.API_SECRET = 'doctor-test-secret';
        process.env.TELEGRAM_BOT_TOKEN = 'tg-test-token';
        process.env.GROQ_API_KEY = 'groq-test-key';
        process.env.OPENROUTER_API_KEY = 'or-test-key';
        mockGetDiagnostics.mockReturnValue(healthySecretDiagnostics());

        app = express();
        app.use(express.json());
    });

    afterEach(() => {
        if (previousApiSecret === undefined) {
            delete process.env.API_SECRET;
        } else {
            process.env.API_SECRET = previousApiSecret;
        }
    });

    it('returns full doctor report with checks array', async () => {
        app.get('/doctor', handleDoctor({}));
        const response = await request(app).get('/doctor');

        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(true);
        expect(Array.isArray(response.body.data.checks)).toBe(true);
        expect(response.body.data.readiness).toBeTruthy();
        expect(response.body.data.readiness.level).toMatch(/^(ready|degraded|not_ready)$/);
    });

    it('each check has id, name, severity, and message fields', async () => {
        app.get('/doctor', handleDoctor({}));
        const response = await request(app).get('/doctor');

        for (const check of response.body.data.checks) {
            expect(typeof check.id).toBe('string');
            expect(typeof check.name).toBe('string');
            expect(['ok', 'warning', 'critical']).toContain(check.severity);
            expect(typeof check.message).toBe('string');
        }
    });

    it('non-ok checks include remediation guidance', async () => {
        delete process.env.API_SECRET; // triggers critical config check

        app.get('/doctor', handleDoctor({}));
        const response = await request(app).get('/doctor');

        const nonOkChecks = response.body.data.checks.filter(
            (c: { severity: string }) => c.severity !== 'ok',
        );
        expect(nonOkChecks.length).toBeGreaterThan(0);
        for (const check of nonOkChecks) {
            expect(typeof check.remediation).toBe('string');
            expect(check.remediation.length).toBeGreaterThan(0);
        }
    });

    it('returns 503 status when runtime is not_ready', async () => {
        delete process.env.API_SECRET;

        app.get('/doctor', handleDoctor({}));
        const response = await request(app).get('/doctor');

        expect(response.status).toBe(503);
        expect(response.body.data.readiness.level).toBe('not_ready');
    });

    it('includes readiness summary counters', async () => {
        app.get('/doctor', handleDoctor({}));
        const response = await request(app).get('/doctor');

        const { readiness } = response.body.data;
        expect(typeof readiness.totalChecks).toBe('number');
        expect(typeof readiness.passed).toBe('number');
        expect(typeof readiness.warnings).toBe('number');
        expect(typeof readiness.critical).toBe('number');
        expect(readiness.passed + readiness.warnings + readiness.critical).toBe(readiness.totalChecks);
    });

    it('diagnostics do not leak raw secrets in output', async () => {
        process.env.API_SECRET = 'ultra-secret-xyz-9876';
        mockGetDiagnostics.mockReturnValue(healthySecretDiagnostics());

        app.get('/doctor', handleDoctor({}));
        const response = await request(app).get('/doctor');

        const serialized = JSON.stringify(response.body);
        expect(serialized).not.toContain('ultra-secret-xyz-9876');
    });
});
