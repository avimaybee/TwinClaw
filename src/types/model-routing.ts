export type ModelRoutingFallbackMode = 'intelligent_pacing' | 'aggressive_fallback';

export type ModelRoutingEventType =
  | 'attempt'
  | 'success'
  | 'failure'
  | 'rate_limit'
  | 'cooldown_set'
  | 'cooldown_wait'
  | 'cooldown_skip'
  | 'failover'
  | 'mode_change';

export interface ModelRoutingCooldownSnapshot {
  modelId: string;
  modelName: string;
  provider: string;
  reason: string;
  remainingMs: number;
  until: string;
}

export interface ModelRoutingUsageSnapshot {
  modelId: string;
  modelName: string;
  provider: string;
  attempts: number;
  successes: number;
  failures: number;
  rateLimits: number;
  lastUsedAt: string | null;
  lastError: string | null;
}

export interface ModelRoutingEventSnapshot {
  id: string;
  type: ModelRoutingEventType;
  modelId: string | null;
  modelName: string | null;
  provider: string | null;
  fallbackMode: ModelRoutingFallbackMode;
  detail: string;
  createdAt: string;
}

export interface ModelRoutingTelemetrySnapshot {
  fallbackMode: ModelRoutingFallbackMode;
  preferredModelId: string | null;
  currentModelId: string | null;
  currentModelName: string | null;
  totalRequests: number;
  totalFailures: number;
  consecutiveFailures: number;
  failoverCount: number;
  lastError: string | null;
  lastFailureAt: string | null;
  activeCooldowns: ModelRoutingCooldownSnapshot[];
  usage: ModelRoutingUsageSnapshot[];
  recentEvents: ModelRoutingEventSnapshot[];
  operatorGuidance: string[];
}
