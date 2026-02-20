import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeBudgetGovernor } from '../../src/services/runtime-budget-governor.js';
import {
  getRuntimeBudgetState,
  getRuntimeDailyUsageAggregate,
  getRuntimeSessionUsageAggregate,
  listRuntimeBudgetEvents,
  listRuntimeProviderUsageAggregates,
  recordRuntimeBudgetEvent,
  recordRuntimeUsageEvent,
  setRuntimeBudgetState,
} from '../../src/services/db.js';

vi.mock('../../src/services/db.js', () => ({
  clearRuntimeBudgetState: vi.fn(),
  getRuntimeBudgetState: vi.fn(),
  getRuntimeDailyUsageAggregate: vi.fn(),
  getRuntimeSessionUsageAggregate: vi.fn(),
  listRuntimeBudgetEvents: vi.fn(),
  listRuntimeProviderUsageAggregates: vi.fn(),
  recordRuntimeBudgetEvent: vi.fn(),
  recordRuntimeUsageEvent: vi.fn(),
  setRuntimeBudgetState: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logThought: vi.fn().mockResolvedValue(undefined),
}));

describe('RuntimeBudgetGovernor', () => {
  const budgetStateStore = new Map<string, string>();

  beforeEach(() => {
    vi.clearAllMocks();
    budgetStateStore.clear();
    vi.mocked(setRuntimeBudgetState).mockImplementation((key: string, value: string) => {
      budgetStateStore.set(key, value);
    });
    vi.mocked(getRuntimeBudgetState).mockImplementation((key: string) => budgetStateStore.get(key) ?? null);
    vi.mocked(getRuntimeDailyUsageAggregate).mockReturnValue(zeroUsageRow());
    vi.mocked(getRuntimeSessionUsageAggregate).mockReturnValue(zeroUsageRow());
    vi.mocked(listRuntimeProviderUsageAggregates).mockReturnValue([]);
    vi.mocked(listRuntimeBudgetEvents).mockReturnValue([]);
  });

  it('enters warning state and balanced profile when warning threshold is crossed', () => {
    vi.mocked(getRuntimeDailyUsageAggregate).mockReturnValue({
      request_count: 84,
      request_tokens: 2_000,
      response_tokens: 1_000,
      failure_count: 2,
      skipped_count: 0,
    });

    const governor = new RuntimeBudgetGovernor({
      limits: {
        dailyRequestLimit: 100,
        dailyTokenLimit: 10_000,
        sessionRequestLimit: 100,
        sessionTokenLimit: 10_000,
        providerRequestLimit: 100,
        providerTokenLimit: 10_000,
        warningRatio: 0.8,
      },
      defaultProfile: 'performance',
    });

    const directive = governor.getRoutingDirective('session-warning');

    expect(directive.severity).toBe('warning');
    expect(directive.profile).toBe('balanced');
    expect(directive.actions).toContain('intelligent_pacing');
    expect(recordRuntimeBudgetEvent).toHaveBeenCalled();
  });

  it('enters hard-limit state and applies fallback tightening', () => {
    vi.mocked(getRuntimeDailyUsageAggregate).mockReturnValue({
      request_count: 130,
      request_tokens: 12_000,
      response_tokens: 1_200,
      failure_count: 4,
      skipped_count: 0,
    });

    const governor = new RuntimeBudgetGovernor({
      limits: {
        dailyRequestLimit: 120,
        dailyTokenLimit: 15_000,
        sessionRequestLimit: 1000,
        sessionTokenLimit: 1_000_000,
        providerRequestLimit: 1000,
        providerTokenLimit: 1_000_000,
      },
      defaultProfile: 'performance',
    });

    const directive = governor.getRoutingDirective('session-hard');

    expect(directive.severity).toBe('hard_limit');
    expect(directive.profile).toBe('economy');
    expect(directive.actions).toContain('fallback_tightening');
    expect(directive.blockedModelIds).toContain('primary');
  });

  it('supports manual profile override persistence', () => {
    const governor = new RuntimeBudgetGovernor({
      defaultProfile: 'performance',
    });

    governor.setManualProfile('economy', 'manual-session');
    const snapshot = governor.getSnapshot('manual-session');

    expect(setRuntimeBudgetState).toHaveBeenCalledWith('manual_profile', 'economy');
    expect(snapshot.manualProfile).toBe('economy');
    expect(snapshot.directive.profile).toBe('economy');
  });

  it('blocks providers during cooldown after 429 failures', () => {
    const governor = new RuntimeBudgetGovernor({
      limits: { providerCooldownMs: 90_000 },
    });

    governor.recordUsage({
      sessionId: 'cooldown-session',
      modelId: 'fallback_2',
      providerId: 'google',
      profile: 'balanced',
      stage: 'failure',
      requestTokens: 120,
      responseTokens: 0,
      latencyMs: 240,
      statusCode: 429,
      error: 'rate-limit',
    });

    const directive = governor.getRoutingDirective('cooldown-session');

    expect(recordRuntimeUsageEvent).toHaveBeenCalled();
    expect(directive.blockedProviders).toContain('google');
    expect(directive.actions).toContain('provider_cooldown');
  });
});

function zeroUsageRow() {
  return {
    request_count: 0,
    request_tokens: 0,
    response_tokens: 0,
    failure_count: 0,
    skipped_count: 0,
  };
}
