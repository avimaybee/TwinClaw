import { randomUUID } from 'node:crypto';
import {
  clearRuntimeBudgetState,
  getRuntimeBudgetState,
  getRuntimeDailyUsageAggregate,
  getRuntimeSessionUsageAggregate,
  listRuntimeBudgetEvents,
  listRuntimeProviderUsageAggregates,
  recordRuntimeBudgetEvent,
  recordRuntimeUsageEvent,
  setRuntimeBudgetState,
  type RuntimeBudgetEventRow,
  type RuntimeUsageAggregateRow,
  type RuntimeUsageEventInput,
} from './db.js';
import type {
  RuntimeBudgetAction,
  RuntimeBudgetDirective,
  RuntimeBudgetEvent,
  RuntimeBudgetLimits,
  RuntimeBudgetProfile,
  RuntimeBudgetSeverity,
  RuntimeBudgetSnapshot,
  RuntimeProviderUsageAggregate,
  RuntimeUsageAggregate,
  RuntimeUsageStage,
} from '../types/runtime-budget.js';
import { logThought } from '../utils/logger.js';
import { getConfigValue } from '../config/config-loader.js';

const MANUAL_PROFILE_KEY = 'manual_profile';
const DEFAULT_SESSION_ID = 'global';
const DEFAULT_LOCAL_MODEL_ID = 'local';

const DEFAULT_LIMITS: RuntimeBudgetLimits = {
  dailyRequestLimit: 2_400,
  dailyTokenLimit: 5_000_000,
  sessionRequestLimit: 300,
  sessionTokenLimit: 700_000,
  providerRequestLimit: 1_000,
  providerTokenLimit: 2_200_000,
  warningRatio: 0.8,
  warningPacingMs: 250,
  hardLimitPacingMs: 1_250,
  providerCooldownMs: 60_000,
};

const PROFILE_ORDER: RuntimeBudgetProfile[] = ['economy', 'balanced', 'performance'];

export interface RuntimeBudgetGovernorConfig {
  limits?: Partial<RuntimeBudgetLimits>;
  defaultProfile?: RuntimeBudgetProfile;
  preferLocalModel?: boolean;
  localModelId?: string;
  now?: () => number;
}

interface RuntimeBudgetEvaluation {
  manualProfile: RuntimeBudgetProfile | null;
  limits: RuntimeBudgetLimits;
  daily: RuntimeUsageAggregate;
  session: RuntimeUsageAggregate;
  providers: RuntimeProviderUsageAggregate[];
  directive: RuntimeBudgetDirective;
}

export class RuntimeBudgetGovernor {
  readonly #limits: RuntimeBudgetLimits;
  readonly #defaultProfile: RuntimeBudgetProfile;
  readonly #preferLocalModel: boolean;
  readonly #localModelId: string;
  readonly #now: () => number;
  readonly #providerCooldowns: Map<string, number> = new Map();
  readonly #signatures: Map<string, string> = new Map();
  #manualProfile: RuntimeBudgetProfile | null;

  constructor(config: RuntimeBudgetGovernorConfig = {}) {
    this.#limits = resolveLimits(config.limits);
    this.#defaultProfile =
      parseProfile(getConfigValue('RUNTIME_BUDGET_DEFAULT_PROFILE')) ??
      config.defaultProfile ??
      'performance';
    this.#preferLocalModel =
      config.preferLocalModel ??
      parseBoolean(getConfigValue('RUNTIME_BUDGET_PREFER_LOCAL_MODEL')) ??
      false;
    this.#localModelId =
      getConfigValue('RUNTIME_BUDGET_LOCAL_MODEL_ID')?.trim() || config.localModelId || DEFAULT_LOCAL_MODEL_ID;
    this.#now = config.now ?? (() => Date.now());
    this.#manualProfile = parseProfile(getRuntimeBudgetState(MANUAL_PROFILE_KEY));
  }

  get limits(): RuntimeBudgetLimits {
    return this.#limits;
  }

  getRoutingDirective(sessionId?: string | null): RuntimeBudgetDirective {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const evaluation = this.#evaluate(normalizedSessionId);
    this.#recordTransition(normalizedSessionId, evaluation);
    return evaluation.directive;
  }

  recordUsage(input: {
    sessionId?: string | null;
    modelId: string;
    providerId: string;
    profile: RuntimeBudgetProfile;
    stage: RuntimeUsageStage;
    requestTokens: number;
    responseTokens: number;
    latencyMs: number;
    statusCode?: number | null;
    error?: string | null;
  }): void {
    const normalizedSessionId = normalizeSessionId(input.sessionId);
    const event: RuntimeUsageEventInput = {
      id: randomUUID(),
      sessionId: normalizedSessionId,
      modelId: input.modelId,
      providerId: input.providerId,
      profile: input.profile,
      stage: input.stage,
      requestTokens: Math.max(0, Math.floor(input.requestTokens)),
      responseTokens: Math.max(0, Math.floor(input.responseTokens)),
      latencyMs: Math.max(0, Math.floor(input.latencyMs)),
      statusCode: input.statusCode ?? null,
      error: input.error ?? null,
    };
    recordRuntimeUsageEvent(event);

    if (input.stage === 'failure' && input.statusCode === 429) {
      this.applyProviderCooldown(input.providerId, normalizedSessionId, 'Rate-limit response detected.');
    }
  }

  applyProviderCooldown(providerId: string, sessionId?: string | null, reason = 'Provider cooldown applied.'): void {
    const normalizedProvider = providerId.trim().toLowerCase();
    if (!normalizedProvider) {
      return;
    }

    const now = this.#now();
    const current = this.#providerCooldowns.get(normalizedProvider) ?? 0;
    const next = Math.max(current, now + this.#limits.providerCooldownMs);
    this.#providerCooldowns.set(normalizedProvider, next);

    const normalizedSessionId = normalizeSessionId(sessionId);
    this.#recordBudgetEvent({
      sessionId: normalizedSessionId,
      severity: 'warning',
      profile: this.#manualProfile ?? this.#defaultProfile,
      action: 'provider_cooldown',
      reason,
      detail: {
        providerId: normalizedProvider,
        cooldownUntil: new Date(next).toISOString(),
      },
    });
  }

  setManualProfile(profile: RuntimeBudgetProfile | null, sessionId?: string | null): void {
    const normalizedSessionId = normalizeSessionId(sessionId);
    this.#manualProfile = profile;
    if (profile) {
      setRuntimeBudgetState(MANUAL_PROFILE_KEY, profile);
    } else {
      clearRuntimeBudgetState(MANUAL_PROFILE_KEY);
    }

    this.#recordBudgetEvent({
      sessionId: normalizedSessionId,
      severity: 'ok',
      profile: profile ?? this.#defaultProfile,
      action: 'none',
      reason: profile
        ? `Manual budget profile override set to '${profile}'.`
        : 'Manual budget profile override cleared.',
      detail: { manualProfile: profile },
    });
  }

  resetPolicyState(sessionId?: string | null): void {
    const normalizedSessionId = normalizeSessionId(sessionId);
    this.#providerCooldowns.clear();
    this.#signatures.clear();
    this.setManualProfile(null, normalizedSessionId);
    this.#recordBudgetEvent({
      sessionId: normalizedSessionId,
      severity: 'ok',
      profile: this.#defaultProfile,
      action: 'none',
      reason: 'Runtime budget policy state reset.',
      detail: {},
    });
  }

  getSnapshot(sessionId?: string | null, eventLimit = 50): RuntimeBudgetSnapshot {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const evaluation = this.#evaluate(normalizedSessionId);
    return {
      sessionId: normalizedSessionId,
      manualProfile: evaluation.manualProfile,
      limits: evaluation.limits,
      daily: evaluation.daily,
      session: evaluation.session,
      providers: evaluation.providers,
      directive: evaluation.directive,
      recentEvents: this.getRecentEvents(eventLimit),
    };
  }

  getRecentEvents(limit = 100): RuntimeBudgetEvent[] {
    return listRuntimeBudgetEvents(limit).map((row) => this.#toEvent(row));
  }

  #evaluate(sessionId: string): RuntimeBudgetEvaluation {
    this.#pruneCooldowns();
    this.#manualProfile = parseProfile(getRuntimeBudgetState(MANUAL_PROFILE_KEY));

    const daily = toUsageAggregate(getRuntimeDailyUsageAggregate());
    const session = toUsageAggregate(getRuntimeSessionUsageAggregate(sessionId));
    const providers = listRuntimeProviderUsageAggregates().map((row) => ({
      providerId: row.provider_id,
      ...toUsageAggregate(row),
    }));

    const severity = resolveSeverity(this.#limits, daily, session, providers);
    const actions = resolveActions(severity, this.#preferLocalModel);
    const blockedProviders = providers
      .filter(
        (provider) =>
          provider.requestCount >= this.#limits.providerRequestLimit ||
          provider.requestTokens >= this.#limits.providerTokenLimit,
      )
      .map((provider) => provider.providerId);

    for (const providerId of blockedProviders) {
      if (!this.#providerCooldowns.has(providerId)) {
        this.#providerCooldowns.set(providerId, this.#now() + this.#limits.providerCooldownMs);
      }
    }

    const cooldownProviders = [...this.#providerCooldowns.entries()]
      .filter(([, until]) => until > this.#now())
      .map(([providerId]) => providerId);
    const finalBlockedProviders = [...new Set([...blockedProviders, ...cooldownProviders])];
    if (finalBlockedProviders.length > 0 && !actions.includes('provider_cooldown')) {
      actions.push('provider_cooldown');
    }

    const profile = this.#manualProfile ?? resolveProfile(this.#defaultProfile, severity);
    const blockedModelIds =
      severity === 'hard_limit'
        ? ['primary']
        : this.#preferLocalModel && profile === 'economy'
          ? ['primary', 'fallback_1', 'fallback_2'].filter((id) => id !== this.#localModelId)
          : [];

    const pacingDelayMs =
      severity === 'hard_limit'
        ? this.#limits.hardLimitPacingMs
        : severity === 'warning'
          ? this.#limits.warningPacingMs
          : 0;

    const directive: RuntimeBudgetDirective = {
      profile,
      severity,
      actions,
      pacingDelayMs,
      blockedModelIds,
      blockedProviders: finalBlockedProviders,
      reason: buildReason(this.#limits, severity, daily, session, providers),
      evaluatedAt: new Date(this.#now()).toISOString(),
    };

    return {
      manualProfile: this.#manualProfile,
      limits: this.#limits,
      daily,
      session,
      providers,
      directive,
    };
  }

  #recordTransition(sessionId: string, evaluation: RuntimeBudgetEvaluation): void {
    const signature = [
      evaluation.directive.severity,
      evaluation.directive.profile,
      evaluation.directive.actions.join(','),
      evaluation.directive.blockedProviders.join(','),
      evaluation.directive.blockedModelIds.join(','),
    ].join('|');

    const previous = this.#signatures.get(sessionId);
    if (previous === signature) {
      return;
    }
    this.#signatures.set(sessionId, signature);

    this.#recordBudgetEvent({
      sessionId,
      severity: evaluation.directive.severity,
      profile: evaluation.directive.profile,
      action: evaluation.directive.actions[0] ?? 'none',
      reason: evaluation.directive.reason,
      detail: {
        actions: evaluation.directive.actions,
        blockedProviders: evaluation.directive.blockedProviders,
        blockedModelIds: evaluation.directive.blockedModelIds,
        pacingDelayMs: evaluation.directive.pacingDelayMs,
      },
    });
  }

  #recordBudgetEvent(input: {
    sessionId: string;
    severity: RuntimeBudgetSeverity;
    profile: RuntimeBudgetProfile;
    action: RuntimeBudgetAction;
    reason: string;
    detail: Record<string, unknown>;
  }): void {
    recordRuntimeBudgetEvent({
      id: randomUUID(),
      sessionId: input.sessionId,
      severity: input.severity,
      profile: input.profile,
      action: input.action,
      reason: input.reason,
      detailJson: JSON.stringify(input.detail),
    });

    void logThought(
      `[RuntimeBudget] severity=${input.severity} profile=${input.profile} action=${input.action} reason=${input.reason}`,
    );
  }

  #toEvent(row: RuntimeBudgetEventRow): RuntimeBudgetEvent {
    return {
      id: row.id,
      sessionId: row.session_id,
      severity: row.severity,
      profile: row.profile,
      action: row.action,
      reason: row.reason,
      detail: parseDetail(row.detail_json),
      createdAt: row.created_at,
    };
  }

  #pruneCooldowns(): void {
    const now = this.#now();
    for (const [providerId, cooldownUntil] of this.#providerCooldowns.entries()) {
      if (cooldownUntil <= now) {
        this.#providerCooldowns.delete(providerId);
      }
    }
  }
}

function normalizeSessionId(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized || DEFAULT_SESSION_ID;
}

function toUsageAggregate(row: RuntimeUsageAggregateRow): RuntimeUsageAggregate {
  return {
    requestCount: Number(row.request_count ?? 0),
    requestTokens: Number(row.request_tokens ?? 0),
    responseTokens: Number(row.response_tokens ?? 0),
    failureCount: Number(row.failure_count ?? 0),
    skippedCount: Number(row.skipped_count ?? 0),
  };
}

function resolveProfile(
  defaultProfile: RuntimeBudgetProfile,
  severity: RuntimeBudgetSeverity,
): RuntimeBudgetProfile {
  if (severity === 'hard_limit') {
    return 'economy';
  }
  if (severity === 'warning' && defaultProfile === 'performance') {
    return 'balanced';
  }
  return defaultProfile;
}

function resolveSeverity(
  limits: RuntimeBudgetLimits,
  daily: RuntimeUsageAggregate,
  session: RuntimeUsageAggregate,
  providers: RuntimeProviderUsageAggregate[],
): RuntimeBudgetSeverity {
  const hardBreached =
    daily.requestCount >= limits.dailyRequestLimit ||
    daily.requestTokens >= limits.dailyTokenLimit ||
    session.requestCount >= limits.sessionRequestLimit ||
    session.requestTokens >= limits.sessionTokenLimit ||
    providers.some(
      (provider) =>
        provider.requestCount >= limits.providerRequestLimit ||
        provider.requestTokens >= limits.providerTokenLimit,
    );
  if (hardBreached) {
    return 'hard_limit';
  }

  const ratios = [
    safeRatio(daily.requestCount, limits.dailyRequestLimit),
    safeRatio(daily.requestTokens, limits.dailyTokenLimit),
    safeRatio(session.requestCount, limits.sessionRequestLimit),
    safeRatio(session.requestTokens, limits.sessionTokenLimit),
    ...providers.flatMap((provider) => [
      safeRatio(provider.requestCount, limits.providerRequestLimit),
      safeRatio(provider.requestTokens, limits.providerTokenLimit),
    ]),
  ];

  if (ratios.some((ratio) => ratio >= limits.warningRatio)) {
    return 'warning';
  }
  return 'ok';
}

function resolveActions(
  severity: RuntimeBudgetSeverity,
  preferLocalModel: boolean,
): RuntimeBudgetAction[] {
  if (severity === 'ok') {
    return ['none'];
  }

  const actions: RuntimeBudgetAction[] = ['intelligent_pacing'];
  if (severity === 'hard_limit') {
    actions.push('fallback_tightening');
    if (preferLocalModel) {
      actions.push('prefer_local_model');
    }
  }
  return actions;
}

function buildReason(
  limits: RuntimeBudgetLimits,
  severity: RuntimeBudgetSeverity,
  daily: RuntimeUsageAggregate,
  session: RuntimeUsageAggregate,
  providers: RuntimeProviderUsageAggregate[],
): string {
  if (severity === 'ok') {
    return 'Budget utilization is below warning thresholds.';
  }

  const providerHeavy = providers
    .filter(
      (provider) =>
        provider.requestCount >= limits.providerRequestLimit * limits.warningRatio ||
        provider.requestTokens >= limits.providerTokenLimit * limits.warningRatio,
    )
    .map((provider) => provider.providerId);

  const parts = [
    `dailyRequests=${daily.requestCount}/${limits.dailyRequestLimit}`,
    `dailyTokens=${daily.requestTokens}/${limits.dailyTokenLimit}`,
    `sessionRequests=${session.requestCount}/${limits.sessionRequestLimit}`,
    `sessionTokens=${session.requestTokens}/${limits.sessionTokenLimit}`,
  ];
  if (providerHeavy.length > 0) {
    parts.push(`providers=${providerHeavy.join(',')}`);
  }

  return severity === 'hard_limit'
    ? `Hard budget threshold reached (${parts.join(' | ')}).`
    : `Warning budget threshold reached (${parts.join(' | ')}).`;
}

function safeRatio(value: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return 0;
  }
  return value / limit;
}

function parseDetail(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function resolveLimits(overrides: Partial<RuntimeBudgetLimits> = {}): RuntimeBudgetLimits {
  return {
    dailyRequestLimit: readIntEnv('RUNTIME_BUDGET_DAILY_REQUEST_LIMIT', overrides.dailyRequestLimit ?? DEFAULT_LIMITS.dailyRequestLimit),
    dailyTokenLimit: readIntEnv('RUNTIME_BUDGET_DAILY_TOKEN_LIMIT', overrides.dailyTokenLimit ?? DEFAULT_LIMITS.dailyTokenLimit),
    sessionRequestLimit: readIntEnv('RUNTIME_BUDGET_SESSION_REQUEST_LIMIT', overrides.sessionRequestLimit ?? DEFAULT_LIMITS.sessionRequestLimit),
    sessionTokenLimit: readIntEnv('RUNTIME_BUDGET_SESSION_TOKEN_LIMIT', overrides.sessionTokenLimit ?? DEFAULT_LIMITS.sessionTokenLimit),
    providerRequestLimit: readIntEnv('RUNTIME_BUDGET_PROVIDER_REQUEST_LIMIT', overrides.providerRequestLimit ?? DEFAULT_LIMITS.providerRequestLimit),
    providerTokenLimit: readIntEnv('RUNTIME_BUDGET_PROVIDER_TOKEN_LIMIT', overrides.providerTokenLimit ?? DEFAULT_LIMITS.providerTokenLimit),
    warningRatio: readFloatEnv('RUNTIME_BUDGET_WARNING_RATIO', overrides.warningRatio ?? DEFAULT_LIMITS.warningRatio),
    warningPacingMs: readIntEnv('RUNTIME_BUDGET_WARNING_PACING_MS', overrides.warningPacingMs ?? DEFAULT_LIMITS.warningPacingMs),
    hardLimitPacingMs: readIntEnv('RUNTIME_BUDGET_HARD_PACING_MS', overrides.hardLimitPacingMs ?? DEFAULT_LIMITS.hardLimitPacingMs),
    providerCooldownMs: readIntEnv('RUNTIME_BUDGET_PROVIDER_COOLDOWN_MS', overrides.providerCooldownMs ?? DEFAULT_LIMITS.providerCooldownMs),
  };
}

function readIntEnv(name: string, fallback: number): number {
  const raw = getConfigValue(name);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function readFloatEnv(name: string, fallback: number): number {
  const raw = getConfigValue(name);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(0.99, Math.max(0.01, parsed));
}

function parseBoolean(raw: string | undefined): boolean | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return null;
}

function parseProfile(raw: string | null | undefined): RuntimeBudgetProfile | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  return PROFILE_ORDER.find((profile) => profile === normalized) ?? null;
}
