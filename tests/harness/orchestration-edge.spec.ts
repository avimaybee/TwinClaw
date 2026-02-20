import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { OrchestrationService } from '../../src/services/orchestration-service.js';
import { createOrchestrationJob, createSession, db } from '../../src/services/db.js';
import type { DelegationBrief, DelegationRequest } from '../../src/types/orchestration.js';

describe('OrchestrationService edge behavior', () => {
  it('marks a job as failed when delegated execution exceeds timeout', async () => {
    const service = new OrchestrationService({ maxRetryAttempts: 0 });
    const request = buildRequest([
      buildBrief('timeout-node', {
        timeoutMs: 20,
      }),
    ]);

    const result = await service.runDelegation(request, async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return 'completed-too-late';
    });

    expect(result.hasFailures).toBe(true);
    expect(result.jobs[0]?.state).toBe('failed');
    expect(result.jobs[0]?.error).toContain('timed out');
  });

  it('opens the circuit breaker after threshold failures and blocks subsequent runs', async () => {
    const service = new OrchestrationService({
      maxRetryAttempts: 0,
      failureCircuitBreakerThreshold: 1,
    });

    const firstRequest = buildRequest([buildBrief('initial-failure')]);
    const firstResult = await service.runDelegation(firstRequest, async () => {
      throw new Error('hard-failure');
    });

    expect(firstResult.jobs[0]?.state).toBe('failed');
    expect(firstResult.hasFailures).toBe(true);

    let invocationCount = 0;
    const secondRequest = buildRequest([buildBrief('blocked-run')]);
    const secondResult = await service.runDelegation(secondRequest, async () => {
      invocationCount += 1;
      return 'should-not-run';
    });

    expect(secondResult.jobs).toHaveLength(0);
    expect(secondResult.hasFailures).toBe(true);
    expect(secondResult.summary).toContain('circuit-breaker');
    expect(invocationCount).toBe(0);
  });
});

function buildBrief(
  id: string,
  overrides?: Partial<DelegationBrief['constraints']>,
): DelegationBrief {
  return {
    id,
    dependsOn: [],
    title: `Node ${id}`,
    objective: `Execute node ${id}`,
    scopedContext: 'edge-test-context',
    expectedOutput: 'Return result text.',
    constraints: {
      toolBudget: 0,
      timeoutMs: overrides?.timeoutMs ?? 2_000,
      maxTurns: overrides?.maxTurns ?? 1,
    },
  };
}

function buildRequest(briefs: DelegationBrief[]): DelegationRequest {
  const sessionId = `test:orchestration:${randomUUID()}`;
  // Fixture invariant: session row must exist BEFORE orchestration_jobs rows
  // are inserted (FK: orchestration_jobs.session_id -> sessions.session_id).
  createSession(sessionId);

  return {
    sessionId,
    parentMessage: 'Edge behavior validation',
    scope: {
      sessionId: `test:scope:${randomUUID()}`,
      memoryContext: '',
      recentMessages: [],
    },
    briefs,
  };
}

// ── FK Integrity Regression Suite ─────────────────────────────────────────────
// These tests guard the fixture invariant: session rows MUST be created before
// orchestration_jobs rows. Violating this order triggers a SQLite FK error.

describe('OrchestrationService FK fixture ordering', () => {
  it('enforces session-parent FK: createOrchestrationJob without a session throws', () => {
    const orphanSessionId = `test:orphan:${randomUUID()}`;
    expect(() =>
      createOrchestrationJob(randomUUID(), orphanSessionId, 'orphan-msg', '{}'),
    ).toThrow();
  });

  it('session-first fixture ordering satisfies FK constraint', () => {
    const sessionId = `test:fk-order:${randomUUID()}`;
    createSession(sessionId);

    expect(() =>
      createOrchestrationJob(randomUUID(), sessionId, 'parent-msg', '{}'),
    ).not.toThrow();

    // Session row must be present in the DB
    const row = db.prepare('SELECT session_id FROM sessions WHERE session_id = ?').get(sessionId);
    expect(row).toBeDefined();
  });

  it('buildRequest helper creates the session before delegation jobs', () => {
    const request = buildRequest([buildBrief('fk-guard-node')]);

    // The session referenced by the request must already exist
    const row = db
      .prepare('SELECT session_id FROM sessions WHERE session_id = ?')
      .get(request.sessionId);
    expect(row).toBeDefined();
  });

  it('runDelegation completes without FK errors when fixture creates session first', async () => {
    const service = new OrchestrationService({ maxRetryAttempts: 0 });
    const request = buildRequest([buildBrief('fk-safe-node')]);

    const result = await service.runDelegation(request, async () => 'fk-safe-output');

    expect(result.hasFailures).toBe(false);
    expect(result.jobs[0]?.state).toBe('completed');
  });
});
