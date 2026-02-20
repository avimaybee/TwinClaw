export type RuntimeBudgetProfile = 'economy' | 'balanced' | 'performance';

export type RuntimeBudgetSeverity = 'ok' | 'warning' | 'hard_limit';

export type RuntimeBudgetAction =
  | 'none'
  | 'intelligent_pacing'
  | 'provider_cooldown'
  | 'fallback_tightening'
  | 'prefer_local_model';

export type RuntimeUsageStage = 'success' | 'failure' | 'skipped';

export interface RuntimeBudgetLimits {
  dailyRequestLimit: number;
  dailyTokenLimit: number;
  sessionRequestLimit: number;
  sessionTokenLimit: number;
  providerRequestLimit: number;
  providerTokenLimit: number;
  warningRatio: number;
  warningPacingMs: number;
  hardLimitPacingMs: number;
  providerCooldownMs: number;
}

export interface RuntimeUsageAggregate {
  requestCount: number;
  requestTokens: number;
  responseTokens: number;
  failureCount: number;
  skippedCount: number;
}

export interface RuntimeProviderUsageAggregate extends RuntimeUsageAggregate {
  providerId: string;
}

export interface RuntimeBudgetDirective {
  profile: RuntimeBudgetProfile;
  severity: RuntimeBudgetSeverity;
  actions: RuntimeBudgetAction[];
  pacingDelayMs: number;
  blockedModelIds: string[];
  blockedProviders: string[];
  reason: string;
  evaluatedAt: string;
}

export interface RuntimeBudgetEvent {
  id: string;
  sessionId: string | null;
  severity: RuntimeBudgetSeverity;
  profile: RuntimeBudgetProfile;
  action: RuntimeBudgetAction;
  reason: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface RuntimeBudgetSnapshot {
  sessionId: string;
  manualProfile: RuntimeBudgetProfile | null;
  limits: RuntimeBudgetLimits;
  daily: RuntimeUsageAggregate;
  session: RuntimeUsageAggregate;
  providers: RuntimeProviderUsageAggregate[];
  directive: RuntimeBudgetDirective;
  recentEvents: RuntimeBudgetEvent[];
}

export interface RuntimeUsageEvent {
  id: string;
  sessionId: string | null;
  modelId: string;
  providerId: string;
  profile: RuntimeBudgetProfile;
  stage: RuntimeUsageStage;
  requestTokens: number;
  responseTokens: number;
  latencyMs: number;
  statusCode: number | null;
  error: string | null;
  createdAt: string;
}
