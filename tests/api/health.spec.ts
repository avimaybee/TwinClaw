import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { handleHealth } from '../../src/api/handlers/health.js';

describe('GET /health routing telemetry', () => {
  let app: Express;
  let previousApiSecret: string | undefined;

  beforeEach(() => {
    previousApiSecret = process.env.API_SECRET;
    process.env.API_SECRET = 'health-test-secret';

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
});
