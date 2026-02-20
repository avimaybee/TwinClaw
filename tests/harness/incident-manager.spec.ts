import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncidentManager } from '../../src/services/incident-manager.js';
import type { Gateway } from '../../src/core/gateway.js';
import type { ModelRouter } from '../../src/services/model-router.js';
import type { QueueService } from '../../src/services/queue-service.js';
import {
  appendIncidentTimelineEntry,
  getCallbackOutcomeCounts,
  listIncidentRecords,
  listIncidentTimeline,
  upsertIncidentRecord,
} from '../../src/services/db.js';

vi.mock('../../src/services/db.js', () => ({
  appendIncidentTimelineEntry: vi.fn(),
  getCallbackOutcomeCounts: vi.fn(),
  listIncidentRecords: vi.fn().mockReturnValue([]),
  listIncidentTimeline: vi.fn().mockReturnValue([]),
  upsertIncidentRecord: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logThought: vi.fn().mockResolvedValue(undefined),
}));

describe('IncidentManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCallbackOutcomeCounts).mockReturnValue({
      accepted: 0,
      duplicate: 0,
      rejected: 0,
    });
    vi.mocked(listIncidentRecords).mockReturnValue([]);
    vi.mocked(listIncidentTimeline).mockReturnValue([]);
  });

  it('detects queue backpressure and applies throttle remediation', () => {
    const queue = createQueueStub({ totalQueued: 45, totalDispatching: 5 });
    const manager = createManager({ queue });

    manager.evaluateNow();

    expect(queue.setProcessingMode).toHaveBeenCalledWith('throttled');
    expect(
      vi.mocked(upsertIncidentRecord).mock.calls.some(
        ([input]) =>
          input.incidentType === 'queue_backpressure' &&
          input.status === 'remediating' &&
          input.remediationAction === 'throttle',
      ),
    ).toBe(true);
  });

  it('enforces remediation cooldown windows to prevent oscillation loops', () => {
    const queue = createQueueStub({ totalQueued: 60, totalDispatching: 10 });
    const manager = createManager({ queue });

    manager.evaluateNow();
    manager.evaluateNow();

    expect(queue.setProcessingMode).toHaveBeenCalledTimes(1);
    expect(
      vi
        .mocked(appendIncidentTimelineEntry)
        .mock.calls.some(([entry]) => entry.eventType === 'cooldown_active'),
    ).toBe(true);
  });

  it('escalates incidents when remediation cannot be executed', () => {
    vi.mocked(getCallbackOutcomeCounts).mockReturnValue({
      accepted: 1,
      duplicate: 0,
      rejected: 6,
    });
    const manager = createManager({ queue: undefined, callbackFailureBurstThreshold: 2 });

    manager.evaluateNow();

    expect(
      vi.mocked(upsertIncidentRecord).mock.calls.some(
        ([input]) =>
          input.incidentType === 'callback_failure_storm' &&
          input.status === 'escalated' &&
          input.remediationAction === 'retry_window_adjustment',
      ),
    ).toBe(true);
  });

  it('keeps escalated incidents escalated while signals remain above threshold', () => {
    vi.mocked(getCallbackOutcomeCounts)
      .mockReturnValueOnce({ accepted: 0, duplicate: 0, rejected: 6 })
      .mockReturnValueOnce({ accepted: 0, duplicate: 0, rejected: 12 });
    const manager = createManager({ queue: undefined, callbackFailureBurstThreshold: 2 });

    manager.evaluateNow();
    manager.evaluateNow();

    const callbackUpserts = vi
      .mocked(upsertIncidentRecord)
      .mock.calls.map(([input]) => input)
      .filter((input) => input.incidentType === 'callback_failure_storm');

    expect(callbackUpserts.some((input) => input.status === 'remediating')).toBe(false);
    expect(callbackUpserts.some((input) => input.status === 'escalated')).toBe(true);
  });

  it('rolls back applied remediations when incident conditions recover', () => {
    const queue = createQueueStub({ totalQueued: 50, totalDispatching: 4 });
    const manager = createManager({ queue });

    manager.evaluateNow();
    queue.updateStats({ totalQueued: 0, totalDispatching: 0, totalFailed: 0, totalDeadLetters: 0 });
    manager.evaluateNow();

    expect(queue.currentMode()).toBe('normal');
    expect(
      vi
        .mocked(appendIncidentTimelineEntry)
        .mock.calls.some(([entry]) => entry.eventType === 'resolved'),
    ).toBe(true);
  });

  it('uses failover remediation when model routing instability is detected', () => {
    const router = createRouterStub({
      consecutiveFailures: 4,
      totalFailures: 4,
      failoverCount: 0,
      lastError: 'provider-timeout',
      lastFailureAt: new Date().toISOString(),
      preferredModelId: 'primary',
      totalRequests: 4,
    });
    const manager = createManager({ queue: undefined, router, modelRoutingFailureThreshold: 3 });

    manager.evaluateNow();

    expect(router.forceFailover).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(upsertIncidentRecord).mock.calls.some(
        ([input]) =>
          input.incidentType === 'model_routing_instability' &&
          input.status === 'remediating' &&
          input.remediationAction === 'failover',
      ),
    ).toBe(true);
  });
});

function createManager(options: {
  queue?: ReturnType<typeof createQueueStub>;
  router?: ReturnType<typeof createRouterStub>;
  callbackFailureBurstThreshold?: number;
  modelRoutingFailureThreshold?: number;
}): IncidentManager {
  const queue = options.queue;
  const gateway = createGatewayStub() as unknown as Gateway;
  const router = (options.router ?? createRouterStub()) as unknown as ModelRouter;

  return new IncidentManager({
    gateway,
    router,
    queue: queue as unknown as QueueService | undefined,
    config: {
      remediationCooldownMs: 60_000,
      callbackFailureBurstThreshold: options.callbackFailureBurstThreshold,
      modelRoutingFailureThreshold: options.modelRoutingFailureThreshold,
    },
  });
}

function createGatewayStub() {
  return {
    getContextDegradationSnapshot: vi.fn().mockReturnValue({
      degradedSessions: 0,
      maxConsecutiveDegradation: 0,
      sessions: [],
    }),
  };
}

function createRouterStub(overrides?: Partial<ReturnType<typeof defaultRouterHealth>>) {
  const health = { ...defaultRouterHealth(), ...overrides };
  return {
    getHealthSnapshot: vi.fn().mockImplementation(() => health),
    forceFailover: vi
      .fn()
      .mockImplementation(() => ({ previousModelId: 'primary', nextModelId: 'fallback_1' })),
    resetPreferredModel: vi.fn(),
  };
}

function defaultRouterHealth() {
  return {
    totalRequests: 0,
    totalFailures: 0,
    consecutiveFailures: 0,
    failoverCount: 0,
    lastError: null as string | null,
    lastFailureAt: null as string | null,
    preferredModelId: 'primary',
  };
}

function createQueueStub(initial?: Partial<QueueStats>) {
  const stats: QueueStats = {
    totalQueued: 0,
    totalDispatching: 0,
    totalFailed: 0,
    totalDeadLetters: 0,
    ...initial,
  };
  let mode: 'normal' | 'throttled' | 'drain' = 'normal';
  let retryWindowMultiplier = 1;

  return {
    getStats: vi.fn().mockImplementation(() => ({ ...stats })),
    getRuntimeControls: vi
      .fn()
      .mockImplementation(() => ({ mode, retryWindowMultiplier })),
    setProcessingMode: vi.fn().mockImplementation((nextMode: 'normal' | 'throttled' | 'drain') => {
      mode = nextMode;
    }),
    setRetryWindowMultiplier: vi.fn().mockImplementation((nextMultiplier: number) => {
      retryWindowMultiplier = nextMultiplier;
    }),
    updateStats(next: Partial<QueueStats>) {
      Object.assign(stats, next);
    },
    currentMode() {
      return mode;
    },
  };
}

interface QueueStats {
  totalQueued: number;
  totalDispatching: number;
  totalFailed: number;
  totalDeadLetters: number;
}
