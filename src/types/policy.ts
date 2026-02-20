export type PolicyAction = 'allow' | 'deny' | 'require_approval';

export interface PolicyRule {
    /** The name of the skill to match. Can be '*' to match any skill. */
    skillName: string;
    /** The action to take if this rule matches. */
    action: PolicyAction;
    /** Optional reason explaining the policy rule. */
    reason?: string;
}

export interface PolicyProfile {
    id: string;
    /** 
     * What to do if no rule matches. 
     * If 'fallback', it defers to the next profile in the chain (e.g., global default).
     */
    defaultAction: PolicyAction | 'fallback';
    rules: PolicyRule[];
}

export interface PolicyDecision {
    action: PolicyAction;
    reason: string;
    skillName: string;
    profileId: string;
}
