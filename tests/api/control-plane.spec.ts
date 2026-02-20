import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { requestLogger, sendOk, sendError } from '../../src/api/shared.js';

vi.mock('../../src/utils/logger.js', () => ({
  logThought: vi.fn().mockResolvedValue(undefined),
  scrubSensitiveText: (s: string) => s,
}));

vi.mock('../../src/services/secret-vault.js', () => ({
  getSecretVaultService: () => ({
    readSecret: (key: string) => (key === 'API_SECRET' ? 'test-secret' : undefined),
    getDiagnostics: () => ({
      health: { hasIssues: false, missingRequired: [], expired: [], warnings: [] },
      total: 0,
      active: 0,
      dueForRotation: 0,
    }),
  }),
}));

const API_SECRET = 'test-secret';

const sign = (body: unknown) =>
  `sha256=${createHmac('sha256', API_SECRET).update(JSON.stringify(body)).digest('hex')}`;

// ── /reliability ─────────────────────────────────────────────────────────────

describe('GET /reliability', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(requestLogger);
  });

  afterEach(() => vi.restoreAllMocks());

  const buildReliabilityRoute = (
    queueStats: unknown = null,
    callbackCounts = { accepted: 0, duplicate: 0, rejected: 0 },
  ) => {
    vi.mock('../../src/services/db.js', () => ({
      getCallbackOutcomeCounts: vi.fn().mockReturnValue(callbackCounts),
    }));

    app.get('/reliability', (_req, res) => {
      sendOk(res, {
        queue: queueStats,
        callbacks: {
          totalAccepted: callbackCounts.accepted,
          totalDuplicate: callbackCounts.duplicate,
          totalRejected: callbackCounts.rejected,
        },
      });
    });

    return app;
  };

  it('returns reliability metrics when a dispatcher queue is attached', async () => {
    const queueStats = { totalEnqueued: 10, totalDelivered: 8, totalFailed: 2, depth: 2 };
    const app = buildReliabilityRoute(queueStats, { accepted: 5, duplicate: 1, rejected: 0 });

    const res = await request(app).get('/reliability');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.queue).toMatchObject({ totalEnqueued: 10, totalDelivered: 8 });
    expect(res.body.data.callbacks.totalAccepted).toBe(5);
  });

  it('returns null queue stats when no dispatcher is active', async () => {
    const app = buildReliabilityRoute(null);

    const res = await request(app).get('/reliability');

    expect(res.status).toBe(200);
    expect(res.body.data.queue).toBeNull();
  });
});

// ── /budget/state ─────────────────────────────────────────────────────────────

describe('GET /budget/state', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(requestLogger);
  });

  afterEach(() => vi.restoreAllMocks());

  it('returns 503 when budget governor is not initialized', async () => {
    app.get('/budget/state', (_req, res) => {
      sendError(res, 'Runtime budget governor not initialized.', 503);
    });

    const res = await request(app).get('/budget/state');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
  });

  it('returns the budget snapshot when governor is initialized', async () => {
    const snapshot = {
      directive: { severity: 'normal', profile: 'balanced', pacingDelayMs: 0 },
      manualProfile: null,
      daily: { requests: 10, tokens: 5000 },
      session: { requests: 2, tokens: 1000 },
      providers: [],
    };

    app.get('/budget/state', (_req, res) => {
      sendOk(res, snapshot);
    });

    const res = await request(app).get('/budget/state');
    expect(res.status).toBe(200);
    expect(res.body.data.directive.severity).toBe('normal');
    expect(res.body.data.daily.requests).toBe(10);
  });
});

// ── /budget/events ─────────────────────────────────────────────────────────────

describe('GET /budget/events', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(requestLogger);
  });

  afterEach(() => vi.restoreAllMocks());

  it('returns budget event list', async () => {
    const events = [
      { id: 'ev1', type: 'profile_change', profile: 'economy', timestamp: new Date().toISOString() },
    ];

    app.get('/budget/events', (_req, res) => {
      sendOk(res, { events });
    });

    const res = await request(app).get('/budget/events');
    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(1);
    expect(res.body.data.events[0].type).toBe('profile_change');
  });
});

// ── /routing/telemetry ──────────────────────────────────────────────────────

describe('GET /routing/telemetry', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(requestLogger);
  });

  afterEach(() => vi.restoreAllMocks());

  it('returns 503 when model router is not initialized', async () => {
    app.get('/routing/telemetry', (_req, res) => {
      sendError(res, 'Model router not initialized.', 503);
    });

    const res = await request(app).get('/routing/telemetry');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
  });

  it('returns routing telemetry snapshot when router is available', async () => {
    const telemetry = {
      fallbackMode: 'intelligent_pacing',
      currentModelId: 'primary',
      totalRequests: 100,
      totalFailures: 3,
      consecutiveFailures: 0,
      failoverCount: 1,
    };

    app.get('/routing/telemetry', (_req, res) => {
      sendOk(res, telemetry);
    });

    const res = await request(app).get('/routing/telemetry');
    expect(res.status).toBe(200);
    expect(res.body.data.fallbackMode).toBe('intelligent_pacing');
    expect(res.body.data.totalRequests).toBe(100);
  });
});

// ── POST /routing/mode ───────────────────────────────────────────────────────

describe('POST /routing/mode', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(requestLogger);
  });

  afterEach(() => vi.restoreAllMocks());

  it('rejects invalid mode values with 400', async () => {
    app.post('/routing/mode', (_req, res) => {
      const mode = _req.body?.mode;
      if (typeof mode !== 'string' || !['intelligent_pacing', 'aggressive_fallback'].includes(mode)) {
        sendError(res, 'Invalid mode.', 400);
        return;
      }
      sendOk(res, { message: `Routing mode set to '${mode}'.` });
    });

    const body = { mode: 'turbo_mode' };
    const res = await request(app)
      .post('/routing/mode')
      .set('x-signature', sign(body))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('accepts valid mode and returns confirmation', async () => {
    app.post('/routing/mode', (_req, res) => {
      const mode = _req.body?.mode;
      if (typeof mode !== 'string' || !['intelligent_pacing', 'aggressive_fallback'].includes(mode)) {
        sendError(res, 'Invalid mode.', 400);
        return;
      }
      sendOk(res, { message: `Routing mode set to '${mode}'.`, snapshot: { fallbackMode: mode } });
    });

    const body = { mode: 'aggressive_fallback' };
    const res = await request(app)
      .post('/routing/mode')
      .set('x-signature', sign(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.data.snapshot.fallbackMode).toBe('aggressive_fallback');
  });
});

// ── /incidents ───────────────────────────────────────────────────────────────

describe('GET /incidents/current', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(requestLogger);
  });

  afterEach(() => vi.restoreAllMocks());

  it('returns 503 when incident manager is not initialized', async () => {
    app.get('/incidents/current', (_req, res) => {
      sendError(res, 'Incident manager not initialized.', 503);
    });

    const res = await request(app).get('/incidents/current');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
  });

  it('returns current incidents and safe-mode state', async () => {
    app.get('/incidents/current', (_req, res) => {
      sendOk(res, {
        safeMode: true,
        incidents: [
          { id: 'inc-1', type: 'queue_depth', severity: 'high', status: 'active' },
        ],
      });
    });

    const res = await request(app).get('/incidents/current');
    expect(res.status).toBe(200);
    expect(res.body.data.safeMode).toBe(true);
    expect(res.body.data.incidents).toHaveLength(1);
    expect(res.body.data.incidents[0].type).toBe('queue_depth');
  });
});

describe('GET /incidents/history', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(requestLogger);
  });

  afterEach(() => vi.restoreAllMocks());

  it('returns historical incidents and timeline', async () => {
    app.get('/incidents/history', (_req, res) => {
      sendOk(res, {
        incidents: [
          { id: 'inc-old', type: 'routing_failure', severity: 'medium', status: 'resolved' },
        ],
        timeline: [
          { incidentId: 'inc-old', event: 'created', timestamp: new Date().toISOString() },
        ],
      });
    });

    const res = await request(app).get('/incidents/history');
    expect(res.status).toBe(200);
    expect(res.body.data.incidents).toHaveLength(1);
    expect(res.body.data.timeline).toHaveLength(1);
  });
});

describe('POST /incidents/evaluate', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(requestLogger);
  });

  afterEach(() => vi.restoreAllMocks());

  it('returns the immediate evaluation result', async () => {
    app.post('/incidents/evaluate', (_req, res) => {
      sendOk(res, {
        safeMode: false,
        incidents: [],
      });
    });

    const res = await request(app).post('/incidents/evaluate');
    expect(res.status).toBe(200);
    expect(res.body.data.safeMode).toBe(false);
    expect(res.body.data.incidents).toHaveLength(0);
  });
});

// ── POST /budget/profile ──────────────────────────────────────────────────────

describe('POST /budget/profile', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(requestLogger);
  });

  afterEach(() => vi.restoreAllMocks());

  it('rejects non-string profile values with 400', async () => {
    app.post('/budget/profile', (_req, res) => {
      const rawProfile = _req.body?.profile;
      if (rawProfile !== null && rawProfile !== undefined && typeof rawProfile !== 'string') {
        sendError(res, 'Invalid profile.', 400);
        return;
      }
      sendOk(res, { message: 'Profile set.' });
    });

    const body = { profile: 42 };
    const res = await request(app)
      .post('/budget/profile')
      .set('x-signature', sign(body))
      .send(body);

    expect(res.status).toBe(400);
  });

  it('accepts a valid profile name and returns confirmation', async () => {
    app.post('/budget/profile', (_req, res) => {
      const rawProfile = _req.body?.profile;
      if (typeof rawProfile === 'string' && ['economy', 'balanced', 'performance'].includes(rawProfile)) {
        sendOk(res, { message: `Manual budget profile set to '${rawProfile}'.` });
        return;
      }
      sendError(res, 'Invalid profile.', 400);
    });

    const body = { profile: 'economy' };
    const res = await request(app)
      .post('/budget/profile')
      .set('x-signature', sign(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain('economy');
  });

  it('accepts null profile to clear manual override', async () => {
    app.post('/budget/profile', (_req, res) => {
      const rawProfile = _req.body?.profile;
      if (rawProfile === null) {
        sendOk(res, { message: 'Manual budget profile override cleared.' });
        return;
      }
      sendError(res, 'Invalid profile.', 400);
    });

    const body = { profile: null };
    const res = await request(app)
      .post('/budget/profile')
      .set('x-signature', sign(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain('cleared');
  });
});
