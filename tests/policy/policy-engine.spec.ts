import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEngine } from '../../src/services/policy-engine.js';
import type { PolicyProfile } from '../../src/types/policy.js';

describe('PolicyEngine Evaluation', () => {
    let engine: PolicyEngine;

    beforeEach(() => {
        engine = new PolicyEngine({
            id: 'global-test-profile',
            defaultAction: 'allow',
            rules: [
                { skillName: 'forbidden_tool', action: 'deny', reason: 'Global blocked' }
            ]
        });
    });

    it('allows unknown tools by default', () => {
        const decision = engine.evaluate('test-session', 'random_tool');
        expect(decision.action).toBe('allow');
        expect(decision.reason).toContain('global default');
    });

    it('blocks tools specified in global profile', () => {
        const decision = engine.evaluate('test-session', 'forbidden_tool');
        expect(decision.action).toBe('deny');
        expect(decision.reason).toBe('Global blocked');
    });

    it('evaluates wildcard rules properly', () => {
        engine.setGlobalProfile({
            id: 'strict-profile',
            defaultAction: 'deny',
            rules: [
                { skillName: 'core_vital_tool', action: 'allow' },
                { skillName: '*', action: 'deny', reason: 'Default wildcard deny' }
            ]
        });

        const goodDecision = engine.evaluate('test-session', 'core_vital_tool');
        expect(goodDecision.action).toBe('allow');

        const badDecision = engine.evaluate('test-session', 'some_other_tool');
        expect(badDecision.action).toBe('deny');
        expect(badDecision.reason).toBe('Default wildcard deny');
    });

    it('prioritizes session overrides over global profile', () => {
        const sessionProfile: PolicyProfile = {
            id: 'session-override',
            defaultAction: 'fallback',
            rules: [
                { skillName: 'forbidden_tool', action: 'allow', reason: 'Session allowed it' }
            ]
        };

        engine.setSessionOverride('test-session', sessionProfile);

        // This tool is forbidden globally, but allowed strictly by the session override
        const decision = engine.evaluate('test-session', 'forbidden_tool');
        expect(decision.action).toBe('allow');
        expect(decision.reason).toBe('Session allowed it');
        expect(decision.profileId).toBe('session-override');
    });

    it('falls back to global if session profile action is fallback', () => {
        const sessionProfile: PolicyProfile = {
            id: 'session-override',
            defaultAction: 'fallback',
            rules: []
        };

        engine.setSessionOverride('test-session', sessionProfile);

        const decision = engine.evaluate('test-session', 'forbidden_tool');
        expect(decision.action).toBe('deny');
        expect(decision.reason).toBe('Global blocked');
        expect(decision.profileId).toBe('global-test-profile');
    });

    it('invokes onDecision hook with correct parameters', () => {
        let loggedSession: string | null = null;
        let loggedAction: string | null = null;

        engine.onDecision = (sessionId, decision) => {
            loggedSession = sessionId;
            loggedAction = decision.action;
        };

        engine.evaluate('tracked-session', 'random_tool');

        expect(loggedSession).toBe('tracked-session');
        expect(loggedAction).toBe('allow');
    });
});
