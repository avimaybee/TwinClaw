import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { handleHealth, handleLiveness, handleReadiness } from '../../src/api/handlers/health.js';
import { resetSecretVaultServiceForTests } from '../../src/services/secret-vault.js';

describe('GET /health routing telemetry', () => {
  let app: Express;
  let previousApiSecret: string | undefined;
  let previousConfigPath: string | undefined;

  beforeEach(() => {
    previousApiSecret = process.env.API_SECRET;
    previousConfigPath = process.env.TWINCLAW_CONFIG_PATH;
    process.env.API_SECRET = 'health-test-secret';
    process.env.TWINCLAW_CONFIG_PATH = '/tmp/twinclaw-health-test-config-does-not-exist.json';
    resetSecretVaultServiceForTests();

    app = express();
    app.use(express.json());
  });

  afterEach(() => {
    if (previousApiSecret === undefined) {
      delete process.env.API_SECRET;
    } else {
      process.env.API_SECRET = previousApiSecret;
    }
    if (previousConfigPath === undefined) {
      delete process.env.TWINCLAW_CONFIG_PATH;
    } else {
      process.env.TWINCLAW_CONFIG_PATH = previousConfigPath;
    }
    resetSecretVaultServiceForTests();
  });

  it('surfaces routing telemetry in health payload', async () => {
    const routingSnapshot = {
      fallbackMode: 'aggressive_fallback',
      preferredModelId: 'primary',
      currentModelId: 'fallback_1',
      currentModelName: 'stepfun/step-3.5-flash:free',
      totalRequests: 14,
      totalFailures: 2,
      consecutiveFailures: 1,
      failoverCount: 2,
      lastError: '429 Too Many Requests',
      lastFailureAt: new Date().toISOString(),
      activeCooldowns: [],
      usage: [],
      recentEvents: [],
      operatorGuidance: ['Routing stable.'],
    } as const;

    const deps = {
      heartbeat: { scheduler: { listJobs: () => [{ status: 'running' }] } },
      skillRegistry: { summary: () => ({ builtin: 1, mcp: 0 }), size: 1 },
      mcpManager: {
        listServers: () => [],
        getSkillPackageDiagnostics: async () => ({
          installed: [],
          activePackageCount: 0,
          blockedPackageCount: 0,
          warnings: [],
          violations: [],
        }),
      },
      modelRouter: { getHealthSnapshot: () => routingSnapshot },
    };

    app.get('/health', handleHealth(deps as any));
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data.routing).toMatchObject({
      fallbackMode: 'aggressive_fallback',
      currentModelId: 'fallback_1',
      failoverCount: 2,
    });
  });

  it('marks health degraded when routing instability is high', async () => {
    const deps = {
      heartbeat: { scheduler: { listJobs: () => [{ status: 'running' }] } },
      skillRegistry: { summary: () => ({ builtin: 1, mcp: 0 }), size: 1 },
      mcpManager: {
        listServers: () => [],
        getSkillPackageDiagnostics: async () => ({
          installed: [],
          activePackageCount: 0,
          blockedPackageCount: 0,
          warnings: [],
          violations: [],
        }),
      },
      modelRouter: {
        getHealthSnapshot: () => ({
          fallbackMode: 'aggressive_fallback',
          preferredModelId: 'primary',
          currentModelId: 'primary',
          currentModelName: 'zai-org/GLM-5-FP8',
          totalRequests: 20,
          totalFailures: 6,
          consecutiveFailures: 4,
          failoverCount: 5,
          lastError: 'HTTP 500',
          lastFailureAt: new Date().toISOString(),
          activeCooldowns: [],
          usage: [],
          recentEvents: [],
          operatorGuidance: ['Routing instability detected.'],
        }),
      },
    };

    app.get('/health', handleHealth(deps as any));
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('degraded');
    expect(response.body.data.routing.consecutiveFailures).toBe(4);
  });

  it('responds alive for liveness probe', async () => {
    app.get('/health/live', handleLiveness());
    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data.status).toBe('alive');
  });

  it('responds ready when heartbeat and required secrets are present', async () => {
    const deps = {
      heartbeat: { scheduler: { listJobs: () => [{ status: 'running' }] } },
      skillRegistry: { summary: () => ({ builtin: 1, mcp: 0 }), size: 1 },
      mcpManager: { listServers: () => [] },
    };
    app.get('/health/ready', handleReadiness(deps as any));
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data.status).toBe('ready');
  });

  it('returns 503 not_ready when heartbeat scheduler is offline', async () => {
    const deps = {
      heartbeat: { scheduler: { listJobs: () => [{ status: 'stopped' }] } },
      skillRegistry: { summary: () => ({ builtin: 1, mcp: 0 }), size: 1 },
      mcpManager: { listServers: () => [] },
    };
    app.get('/health/ready', handleReadiness(deps as any));
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not_ready');
  });

  it('returns 503 not_ready when API_SECRET is missing', async () => {
    delete process.env.API_SECRET;
    resetSecretVaultServiceForTests();

    const deps = {
      heartbeat: { scheduler: { listJobs: () => [{ status: 'running' }] } },
      skillRegistry: { summary: () => ({ builtin: 1, mcp: 0 }), size: 1 },
      mcpManager: { listServers: () => [] },
    };
    app.get('/health/ready', handleReadiness(deps as any));
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not_ready');
    expect(response.body.reason).toMatch(/missing critical secrets/i);
  });
});
