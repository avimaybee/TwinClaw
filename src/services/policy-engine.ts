import type { PolicyAction, PolicyDecision, PolicyProfile, PolicyRule } from '../types/policy.js';

export class PolicyEngine {
    private globalProfile: PolicyProfile;
    private sessionOverrides: Map<string, PolicyProfile> = new Map();

    // Optional hook for logging all policy decisions
    public onDecision?: (sessionId: string | null, decision: PolicyDecision) => void;

    constructor(globalProfile?: PolicyProfile) {
        this.globalProfile = globalProfile ?? {
            id: 'global-default',
            defaultAction: 'allow', // By default TwinClaw allows if no rule matches
            rules: [],
        };
    }

    public setGlobalProfile(profile: PolicyProfile): void {
        this.globalProfile = profile;
    }

    public setSessionOverride(sessionId: string, profile: PolicyProfile): void {
        this.sessionOverrides.set(sessionId, profile);
    }

    public removeSessionOverride(sessionId: string): void {
        this.sessionOverrides.delete(sessionId);
    }

    public getSessionOverride(sessionId: string): PolicyProfile | undefined {
        return this.sessionOverrides.get(sessionId);
    }

    /**
     * Evaluates the policy for a given tool execution.
     * Deterministically orders checks: Session Override rules -> Session Default -> Global Rules -> Global Default.
     */
    public evaluate(sessionId: string, skillName: string): PolicyDecision {
        const sessionProfile = this.sessionOverrides.get(sessionId);

        // 1. Session Override rules
        if (sessionProfile) {
            const ruleMatch = this.#findRuleMatch(sessionProfile, skillName);
            if (ruleMatch) {
                return this.#finalizeDecision(sessionId, {
                    action: ruleMatch.action,
                    reason: ruleMatch.reason ?? `Matched specific override rule in profile '${sessionProfile.id}'`,
                    skillName,
                    profileId: sessionProfile.id,
                });
            }

            // 2. Session Profile default (if not fallback)
            if (sessionProfile.defaultAction !== 'fallback') {
                return this.#finalizeDecision(sessionId, {
                    action: sessionProfile.defaultAction,
                    reason: `Fell back to default action in profile '${sessionProfile.id}'`,
                    skillName,
                    profileId: sessionProfile.id,
                });
            }
        }

        // 3. Global Profile rules
        const globalRuleMatch = this.#findRuleMatch(this.globalProfile, skillName);
        if (globalRuleMatch) {
            return this.#finalizeDecision(sessionId, {
                action: globalRuleMatch.action,
                reason: globalRuleMatch.reason ?? `Matched specific rule in global profile '${this.globalProfile.id}'`,
                skillName,
                profileId: this.globalProfile.id,
            });
        }

        // 4. Global Default action
        return this.#finalizeDecision(sessionId, {
            action: this.globalProfile.defaultAction === 'fallback' ? 'allow' : this.globalProfile.defaultAction,
            reason: `Fell back to global default action in profile '${this.globalProfile.id}'`,
            skillName,
            profileId: this.globalProfile.id,
        });
    }

    #findRuleMatch(profile: PolicyProfile, skillName: string): PolicyRule | undefined {
        // Exact match first
        const exact = profile.rules.find((r) => r.skillName === skillName);
        if (exact) return exact;

        // Wildcard match
        const wildcard = profile.rules.find((r) => r.skillName === '*');
        if (wildcard) return wildcard;

        return undefined;
    }

    #finalizeDecision(sessionId: string | null, decision: PolicyDecision): PolicyDecision {
        if (this.onDecision) {
            try {
                this.onDecision(sessionId, decision);
            } catch (e) {
                console.error(`[PolicyEngine] Error in decision reporting hook:`, e);
            }
        }
        return decision;
    }
}
