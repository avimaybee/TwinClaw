import { describe, expect, it, vi } from 'vitest';
import { PolicyEngine } from '../../src/services/policy-engine.js';
import type { PolicyProfile } from '../../src/types/policy.js';

describe('PolicyEngine', () => {
  it('uses session override rules before global rules', () => {
    const globalProfile: PolicyProfile = {
      id: 'global',
      defaultAction: 'allow',
      rules: [{ skillName: 'read_file', action: 'deny', reason: 'global deny' }],
    };

    const engine = new PolicyEngine(globalProfile);
    engine.setSessionOverride('session-1', {
      id: 'session-override',
      defaultAction: 'fallback',
      rules: [{ skillName: 'read_file', action: 'allow', reason: 'session allow' }],
    });

    const decision = engine.evaluate('session-1', 'read_file');

    expect(decision.action).toBe('allow');
    expect(decision.reason).toContain('session allow');
    expect(decision.profileId).toBe('session-override');
  });

  it('falls back to session default when no session rule matches and default is not fallback', () => {
    const engine = new PolicyEngine({
      id: 'global',
      defaultAction: 'allow',
      rules: [],
    });

    engine.setSessionOverride('session-2', {
      id: 'session-default',
      defaultAction: 'deny',
      rules: [],
    });

    const decision = engine.evaluate('session-2', 'shell_exec');

    expect(decision.action).toBe('deny');
    expect(decision.profileId).toBe('session-default');
    expect(decision.reason).toContain('default action');
  });

  it('supports wildcard matching and global fallback semantics', () => {
    const engine = new PolicyEngine({
      id: 'global',
      defaultAction: 'fallback',
      rules: [{ skillName: '*', action: 'deny', reason: 'wildcard block' }],
    });

    const denied = engine.evaluate('session-3', 'delete_file');
    expect(denied.action).toBe('deny');
    expect(denied.reason).toContain('wildcard block');

    engine.setGlobalProfile({
      id: 'global-fallback',
      defaultAction: 'fallback',
      rules: [],
    });

    const fallbackAllowed = engine.evaluate('session-3', 'list_files');
    expect(fallbackAllowed.action).toBe('allow');
    expect(fallbackAllowed.profileId).toBe('global-fallback');
  });

  it('invokes onDecision hook and does not fail evaluation if hook throws', () => {
    const engine = new PolicyEngine();
    const onDecision = vi.fn(() => {
      throw new Error('hook-failure');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    engine.onDecision = onDecision;
    const decision = engine.evaluate('session-4', 'list_files');

    expect(decision.action).toBe('allow');
    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });
});
