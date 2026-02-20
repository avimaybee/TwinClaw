import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handlePersonaStateGet, handlePersonaStateUpdate } from '../../src/api/handlers/persona-state.js';
import { PersonaStateService } from '../../src/services/persona-state.js';

describe('Persona state API handlers', () => {
  let app: Express;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'twinclaw-persona-api-'));
    const service = new PersonaStateService({
      identityDir: tempDir,
      auditLogger: vi.fn(),
    });

    app = express();
    app.use(express.json());
    app.get('/persona/state', handlePersonaStateGet({ personaStateService: service }));
    app.put('/persona/state', handlePersonaStateUpdate({ personaStateService: service }));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns default persona state when files are absent', async () => {
    const response = await request(app).get('/persona/state');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data.revision).toBeTypeOf('string');
    expect(response.body.data.soul).toBe('');
    expect(response.body.data.identity).toBe('');
    expect(response.body.data.user).toBe('');

  });

  it('returns validation diagnostics for invalid update payloads', async () => {
    const response = await request(app).put('/persona/state').send({
      expectedRevision: '',
      soul: 42,
      identity: 'ok',
    });

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(Array.isArray(response.body.data.hints)).toBe(true);
    expect(response.body.data.hints.length).toBeGreaterThan(0);

  });

  it('persists persona updates and detects stale revisions', async () => {
    const initial = await request(app).get('/persona/state');
    const initialRevision = initial.body.data.revision as string;

    const firstUpdate = await request(app).put('/persona/state').send({
      expectedRevision: initialRevision,
      soul: 'Core directives',
      identity: 'Assistant identity',
      user: 'Operator profile',
    });

    expect(firstUpdate.status).toBe(200);
    expect(firstUpdate.body.data.diagnostics.outcome).toBe('updated');
    expect(firstUpdate.body.data.state.revision).toBeTypeOf('string');

    const afterUpdate = await request(app).get('/persona/state');
    expect(afterUpdate.body.data.soul).toBe('Core directives');
    expect(afterUpdate.body.data.identity).toBe('Assistant identity');
    expect(afterUpdate.body.data.user).toBe('Operator profile');

    const staleAttempt = await request(app).put('/persona/state').send({
      expectedRevision: initialRevision,
      soul: 'stale write',
      identity: 'stale write',
      user: 'stale write',
    });

    expect(staleAttempt.status).toBe(409);
    expect(staleAttempt.body.ok).toBe(false);
    expect(staleAttempt.body.data.latestRevision).toBeTypeOf('string');

  });
});
