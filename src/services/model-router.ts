import { randomUUID } from 'node:crypto';
import { Message, ModelConfig, Tool } from '../core/types.js';
import type {
  ModelRoutingCooldownSnapshot,
  ModelRoutingEventSnapshot,
  ModelRoutingEventType,
  ModelRoutingFallbackMode,
  ModelRoutingTelemetrySnapshot,
  ModelRoutingUsageSnapshot,
} from '../types/model-routing.js';
import { scrubSensitiveText } from '../utils/logger.js';
import {
  getModelRoutingSetting,
  listModelRoutingEvents,
  saveModelRoutingEvent,
  saveModelRoutingSetting,
} from './db.js';
import { getSecretVaultService } from './secret-vault.js';
import { RuntimeBudgetGovernor } from './runtime-budget-governor.js';
import type { RuntimeBudgetDirective, RuntimeBudgetProfile, RuntimeBudgetSnapshot } from '../types/runtime-budget.js';

interface ModelRouterMetrics {
  totalRequests: number;
  totalFailures: number;
  consecutiveFailures: number;
  failoverCount: number;
  lastError: string | null;
  lastFailureAt: string | null;
}

interface ModelUsageRuntimeState extends ModelRoutingUsageSnapshot {
  cooldownUntilMs: number | null;
  cooldownReason: string | null;
}

interface ModelAttemptResult {
  ok: boolean;
  message?: Message;
  errorMessage?: string;
  statusCode?: number;
  rateLimitCooldownMs?: number;
}

export type ModelRoutingHealthSnapshot = ModelRoutingTelemetrySnapshot;

export interface ModelRouterOptions {
  budgetGovernor?: RuntimeBudgetGovernor;
  fallbackMode?: ModelRoutingFallbackMode;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  defaultRateLimitCooldownMs?: number;
  intelligentPacingMaxWaitMs?: number;
  maxRuntimeEvents?: number;
  maxPersistedEvents?: number;
}

export interface ModelRequestContext {
  sessionId?: string;
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_SESSION_ID = 'global';
const FALLBACK_MODE_SETTING_KEY = 'fallback_mode';
const DEFAULT_FALLBACK_MODE: ModelRoutingFallbackMode = 'aggressive_fallback';
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000;
const DEFAULT_INTELLIGENT_PACING_MAX_WAIT_MS = 5_000;
const DEFAULT_MAX_RUNTIME_EVENTS = 120;
const DEFAULT_MAX_PERSISTED_EVENTS = 500;
const DEFAULT_BOOTSTRAP_EVENT_COUNT = 30;

function isFallbackMode(value: string | null | undefined): value is ModelRoutingFallbackMode {
  return value === 'intelligent_pacing' || value === 'aggressive_fallback';
}

function parseRetryAfterMs(rawHeader: string | null): number | null {
  if (!rawHeader) {
    return null;
  }

  const asSeconds = Number(rawHeader);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.floor(asSeconds * 1_000);
  }

  const asDateMs = Date.parse(rawHeader);
  if (!Number.isFinite(asDateMs)) {
    return null;
  }
  return Math.max(0, asDateMs - Date.now());
}

function parseEventDetail(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { detail?: string };
    if (typeof parsed.detail === 'string') {
      return parsed.detail;
    }
  } catch {
    // fall through
  }
  return raw;
}

export class ModelRouter {
  private readonly models: ModelConfig[];
  private preferredModelIndex = 0;
  private readonly budgetGovernor: RuntimeBudgetGovernor;
  private readonly usageByModel: Map<string, ModelUsageRuntimeState> = new Map();
  private readonly runtimeEvents: ModelRoutingEventSnapshot[] = [];
  private readonly nowFn: () => number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly defaultRateLimitCooldownMs: number;
  private readonly intelligentPacingMaxWaitMs: number;
  private readonly maxRuntimeEvents: number;
  private readonly maxPersistedEvents: number;
  private fallbackMode: ModelRoutingFallbackMode;
  private currentModelId: string | null = null;
  private metrics: ModelRouterMetrics = {
    totalRequests: 0,
    totalFailures: 0,
    consecutiveFailures: 0,
    failoverCount: 0,
    lastError: null,
    lastFailureAt: null,
  };

  constructor(options: ModelRouterOptions = {}) {
    this.models = [
      {
        id: 'primary',
        model: 'zai-org/GLM-5-FP8',
        baseURL: 'https://api.us-west-2.modal.direct/v1/chat/completions',
        apiKeyEnvName: 'MODAL_API_KEY',
      },
      {
        id: 'fallback_1',
        model: 'stepfun/step-3.5-flash:free',
        baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        apiKeyEnvName: 'OPENROUTER_API_KEY',
      },
      {
        id: 'fallback_2',
        model: 'gemini-flash-lite-latest',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        apiKeyEnvName: 'GEMINI_API_KEY',
      },
    ];
    this.budgetGovernor = options.budgetGovernor ?? new RuntimeBudgetGovernor();
    this.nowFn = options.now ?? (() => Date.now());
    this.sleepFn = options.sleep ?? sleep;
    this.defaultRateLimitCooldownMs = Math.max(
      1_000,
      Math.floor(options.defaultRateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS),
    );
    this.intelligentPacingMaxWaitMs = Math.max(
      0,
      Math.floor(options.intelligentPacingMaxWaitMs ?? DEFAULT_INTELLIGENT_PACING_MAX_WAIT_MS),
    );
    this.maxRuntimeEvents = Math.max(10, Math.floor(options.maxRuntimeEvents ?? DEFAULT_MAX_RUNTIME_EVENTS));
    this.maxPersistedEvents = Math.max(50, Math.floor(options.maxPersistedEvents ?? DEFAULT_MAX_PERSISTED_EVENTS));

    for (const model of this.models) {
      this.usageByModel.set(model.id, {
        modelId: model.id,
        modelName: model.model,
        provider: this.resolveProviderId(model),
        attempts: 0,
        successes: 0,
        failures: 0,
        rateLimits: 0,
        lastUsedAt: null,
        lastError: null,
        cooldownUntilMs: null,
        cooldownReason: null,
      });
    }

    this.fallbackMode = this.resolveInitialFallbackMode(options.fallbackMode);
    this.hydrateRecentEvents();
  }

  public getFallbackMode(): ModelRoutingFallbackMode {
    return this.fallbackMode;
  }

  public setFallbackMode(mode: ModelRoutingFallbackMode): ModelRoutingHealthSnapshot {
    if (mode === this.fallbackMode) {
      return this.getHealthSnapshot();
    }

    const previousMode = this.fallbackMode;
    this.fallbackMode = mode;
    this.persistFallbackMode(mode);
    this.recordEvent('mode_change', null, `Fallback mode changed ${previousMode} -> ${mode}.`);
    return this.getHealthSnapshot();
  }

  public getHealthSnapshot(): ModelRoutingHealthSnapshot {
    const activeCooldowns = this.getActiveCooldowns();
    const usage = this.models
      .map((model) => this.usageByModel.get(model.id))
      .filter((entry): entry is ModelUsageRuntimeState => Boolean(entry))
      .map((entry) => ({
        modelId: entry.modelId,
        modelName: entry.modelName,
        provider: entry.provider,
        attempts: entry.attempts,
        successes: entry.successes,
        failures: entry.failures,
        rateLimits: entry.rateLimits,
        lastUsedAt: entry.lastUsedAt,
        lastError: entry.lastError,
      }));

    return {
      fallbackMode: this.fallbackMode,
      preferredModelId: this.models[this.preferredModelIndex]?.id ?? null,
      currentModelId: this.currentModelId,
      currentModelName: this.currentModelId
        ? this.models.find((model) => model.id === this.currentModelId)?.model ?? null
        : null,
      totalRequests: this.metrics.totalRequests,
      totalFailures: this.metrics.totalFailures,
      consecutiveFailures: this.metrics.consecutiveFailures,
      failoverCount: this.metrics.failoverCount,
      lastError: this.metrics.lastError,
      lastFailureAt: this.metrics.lastFailureAt,
      activeCooldowns,
      usage,
      recentEvents: [...this.runtimeEvents],
      operatorGuidance: this.buildOperatorGuidance(activeCooldowns),
    };
  }

  public getBudgetSnapshot(sessionId?: string): RuntimeBudgetSnapshot {
    return this.budgetGovernor.getSnapshot(sessionId ?? DEFAULT_SESSION_ID, 80);
  }

  public setBudgetProfile(profile: RuntimeBudgetProfile | null, sessionId?: string): void {
    this.budgetGovernor.setManualProfile(profile, sessionId ?? DEFAULT_SESSION_ID);
  }

  public resetBudgetPolicyState(sessionId?: string): void {
    this.budgetGovernor.resetPolicyState(sessionId ?? DEFAULT_SESSION_ID);
  }

  public forceFailover(): { previousModelId: string | null; nextModelId: string | null } {
    const previousModelId = this.models[this.preferredModelIndex]?.id ?? null;
    if (!this.models.length) {
      return { previousModelId, nextModelId: null };
    }

    this.preferredModelIndex = (this.preferredModelIndex + 1) % this.models.length;
    this.metrics.failoverCount += 1;
    const nextModelId = this.models[this.preferredModelIndex]?.id ?? null;
    this.recordEvent(
      'failover',
      this.models[this.preferredModelIndex] ?? null,
      `Forced failover applied: ${previousModelId ?? 'none'} -> ${nextModelId ?? 'none'}.`,
    );
    console.log(`[Router] Forced failover applied: ${previousModelId} -> ${nextModelId}`);
    return { previousModelId, nextModelId };
  }

  public resetPreferredModel(): void {
    this.preferredModelIndex = 0;
  }

  public async createChatCompletion(messages: Message[], tools?: Tool[], context: ModelRequestContext = {}) {
    let lastError: Error | null = null;
    let lastTriedModelId: string | null = null;
    const sessionId = context.sessionId ?? DEFAULT_SESSION_ID;
    const directive = this.budgetGovernor.getRoutingDirective(sessionId);
    if (directive.pacingDelayMs > 0) {
      await this.sleepFn(directive.pacingDelayMs);
    }

    const orderedModels = this.getOrderedModels(directive.profile);
    const formattedTools = tools?.length
      ? tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }))
      : undefined;
    const estimatedRequestTokens = estimateRequestTokens(messages, formattedTools);

    for (const config of orderedModels) {
      const providerId = this.resolveProviderId(config);

      if (directive.blockedProviders.includes(providerId) || directive.blockedModelIds.includes(config.id)) {
        this.budgetGovernor.recordUsage({
          sessionId,
          modelId: config.id,
          providerId,
          profile: directive.profile,
          stage: 'skipped',
          requestTokens: estimatedRequestTokens,
          responseTokens: 0,
          latencyMs: 0,
          error: `Skipped by runtime budget policy (${directive.severity}).`,
        });
        this.recordEvent(
          'cooldown_skip',
          config,
          `Skipped by runtime budget policy (${directive.severity}).`,
        );
        continue;
      }

      const preflightCooldown = await this.resolveCooldownPreflight(config);
      if (!preflightCooldown) {
        lastTriedModelId = config.id;
        continue;
      }

      const apiKey = this.getApiKey(config.apiKeyEnvName);
      if (!apiKey) {
        continue;
      }

      if (lastTriedModelId && lastTriedModelId !== config.id) {
        this.metrics.failoverCount += 1;
        this.recordEvent('failover', config, `Automatic fallback ${lastTriedModelId} -> ${config.id}.`);
      }

      const payload: Record<string, unknown> = {
        model: config.model,
        messages,
      };
      if (formattedTools) {
        payload.tools = formattedTools;
        payload.tool_choice = 'auto';
      }

      const firstAttempt = await this.executeHttpAttempt({
        config,
        apiKey,
        payload,
        providerId,
        sessionId,
        directive,
        estimatedRequestTokens,
      });

      if (firstAttempt.ok && firstAttempt.message) {
        return firstAttempt.message;
      }

      if (
        firstAttempt.statusCode === 429 &&
        this.fallbackMode === 'intelligent_pacing' &&
        typeof firstAttempt.rateLimitCooldownMs === 'number'
      ) {
        const retryWaitMs = Math.min(firstAttempt.rateLimitCooldownMs, this.intelligentPacingMaxWaitMs);
        if (retryWaitMs > 0) {
          this.recordEvent(
            'cooldown_wait',
            config,
            `Intelligent pacing wait ${retryWaitMs}ms before retrying ${config.id}.`,
          );
          await this.sleepFn(retryWaitMs);
        }

        const retryCooldown = this.getModelCooldownState(config.id);
        if (retryCooldown.remainingMs <= 0) {
          const retryAttempt = await this.executeHttpAttempt({
            config,
            apiKey,
            payload,
            providerId,
            sessionId,
            directive,
            estimatedRequestTokens,
          });
          if (retryAttempt.ok && retryAttempt.message) {
            return retryAttempt.message;
          }
          if (retryAttempt.errorMessage) {
            lastError = new Error(retryAttempt.errorMessage);
          }
        } else {
          this.recordEvent(
            'cooldown_skip',
            config,
            `Retry skipped; cooldown still active for ${retryCooldown.remainingMs}ms.`,
          );
        }
      }

      if (firstAttempt.errorMessage) {
        lastError = new Error(firstAttempt.errorMessage);
      }
      lastTriedModelId = config.id;
    }

    throw new Error(
      `All configured models exhausted or failed. Last error: ${scrubSensitiveText(lastError?.message ?? 'unknown')}`,
    );
  }

  private getApiKey(envName: string): string {
    const key = getSecretVaultService().readSecret(envName);
    if (!key) {
      console.warn(`Warning: API key ${envName} is not set in environment.`);
      return '';
    }
    return key;
  }

  private resolveInitialFallbackMode(override?: ModelRoutingFallbackMode): ModelRoutingFallbackMode {
    if (override) {
      this.persistFallbackMode(override);
      return override;
    }

    const persisted = getModelRoutingSetting(FALLBACK_MODE_SETTING_KEY);
    if (isFallbackMode(persisted)) {
      return persisted;
    }

    const fromEnv = process.env.MODEL_ROUTING_FALLBACK_MODE;
    const resolved = isFallbackMode(fromEnv) ? fromEnv : DEFAULT_FALLBACK_MODE;
    this.persistFallbackMode(resolved);
    return resolved;
  }

  private persistFallbackMode(mode: ModelRoutingFallbackMode): void {
    try {
      saveModelRoutingSetting(FALLBACK_MODE_SETTING_KEY, mode);
    } catch (error) {
      const message = scrubSensitiveText(error instanceof Error ? error.message : String(error));
      console.warn(`[Router] Failed to persist fallback mode: ${message}`);
    }
  }

  private hydrateRecentEvents(): void {
    try {
      const rows = listModelRoutingEvents(Math.min(this.maxRuntimeEvents, DEFAULT_BOOTSTRAP_EVENT_COUNT));
      this.runtimeEvents.push(
        ...rows.map((row) => ({
          id: row.id,
          type: row.event_type,
          modelId: row.model_id,
          modelName: row.model_name,
          provider: row.provider,
          fallbackMode: row.fallback_mode,
          detail: scrubSensitiveText(parseEventDetail(row.detail_json)),
          createdAt: row.created_at,
        })),
      );
    } catch (error) {
      const message = scrubSensitiveText(error instanceof Error ? error.message : String(error));
      console.warn(`[Router] Failed to hydrate model routing events: ${message}`);
    }
  }

  private async resolveCooldownPreflight(config: ModelConfig): Promise<boolean> {
    const cooldown = this.getModelCooldownState(config.id);
    if (cooldown.remainingMs <= 0) {
      return true;
    }

    if (this.fallbackMode === 'aggressive_fallback') {
      this.recordEvent(
        'cooldown_skip',
        config,
        `Skipped ${config.id}; cooldown active for ${cooldown.remainingMs}ms.`,
      );
      return false;
    }

    const waitMs = Math.min(cooldown.remainingMs, this.intelligentPacingMaxWaitMs);
    if (waitMs > 0) {
      this.recordEvent('cooldown_wait', config, `Waiting ${waitMs}ms for ${config.id} cooldown.`);
      await this.sleepFn(waitMs);
    }

    const postWaitCooldown = this.getModelCooldownState(config.id);
    if (postWaitCooldown.remainingMs > 0) {
      this.recordEvent(
        'cooldown_skip',
        config,
        `Cooldown for ${config.id} remains active (${postWaitCooldown.remainingMs}ms).`,
      );
      return false;
    }
    return true;
  }

  private async executeHttpAttempt(input: {
    config: ModelConfig;
    apiKey: string;
    payload: Record<string, unknown>;
    providerId: string;
    sessionId: string;
    directive: RuntimeBudgetDirective;
    estimatedRequestTokens: number;
  }): Promise<ModelAttemptResult> {
    this.metrics.totalRequests += 1;
    this.trackUsageAttempt(input.config.id);
    this.recordEvent(
      'attempt',
      input.config,
      `Attempting ${input.config.model} (profile=${input.directive.profile}, severity=${input.directive.severity}).`,
    );

    const startedAt = this.nowFn();
    try {
      const response = await fetch(input.config.baseURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.apiKey}`,
          ...(input.config.id === 'fallback_1'
            ? { 'HTTP-Referer': 'https://twinclaw.ai', 'X-Title': 'TwinClaw' }
            : {}),
        },
        body: JSON.stringify(input.payload),
      });
      const latencyMs = this.nowFn() - startedAt;

      if (response.status === 429) {
        const cooldownMs =
          parseRetryAfterMs(response.headers.get('retry-after')) ?? this.defaultRateLimitCooldownMs;
        this.#recordFailure(`429 Too Many Requests: ${input.config.model}`);
        this.trackUsageFailure(input.config.id, `429 Too Many Requests: ${input.config.model}`, true);
        this.budgetGovernor.recordUsage({
          sessionId: input.sessionId,
          modelId: input.config.id,
          providerId: input.providerId,
          profile: input.directive.profile,
          stage: 'failure',
          requestTokens: input.estimatedRequestTokens,
          responseTokens: 0,
          latencyMs,
          statusCode: 429,
          error: `429 Too Many Requests: ${input.config.model}`,
        });
        this.budgetGovernor.applyProviderCooldown(
          input.providerId,
          input.sessionId,
          'Provider returned 429; cooldown activated.',
        );
        this.setModelCooldown(input.config.id, cooldownMs, '429 rate-limit');
        this.recordEvent(
          'rate_limit',
          input.config,
          `Rate limit on ${input.config.id}; cooldown=${cooldownMs}ms; mode=${this.fallbackMode}.`,
        );
        return {
          ok: false,
          errorMessage: `429 Too Many Requests: ${input.config.model}`,
          statusCode: 429,
          rateLimitCooldownMs: cooldownMs,
        };
      }

      if (!response.ok) {
        const errText = scrubSensitiveText(await response.text());
        const errorMessage = `HTTP ${response.status}: ${errText}`;
        this.#recordFailure(errorMessage);
        this.trackUsageFailure(input.config.id, errorMessage);
        this.budgetGovernor.recordUsage({
          sessionId: input.sessionId,
          modelId: input.config.id,
          providerId: input.providerId,
          profile: input.directive.profile,
          stage: 'failure',
          requestTokens: input.estimatedRequestTokens,
          responseTokens: 0,
          latencyMs,
          statusCode: response.status,
          error: errorMessage,
        });
        this.recordEvent('failure', input.config, `HTTP error (${response.status}) for ${input.config.id}.`);
        return { ok: false, errorMessage, statusCode: response.status };
      }

      const data = await response.json() as { choices?: Array<{ message?: Message }> };
      const message = data?.choices?.[0]?.message;
      if (!message) {
        const errorMessage = `Model ${input.config.id} returned empty choices payload.`;
        this.#recordFailure(errorMessage);
        this.trackUsageFailure(input.config.id, errorMessage);
        this.budgetGovernor.recordUsage({
          sessionId: input.sessionId,
          modelId: input.config.id,
          providerId: input.providerId,
          profile: input.directive.profile,
          stage: 'failure',
          requestTokens: input.estimatedRequestTokens,
          responseTokens: 0,
          latencyMs,
          statusCode: response.status,
          error: errorMessage,
        });
        this.recordEvent('failure', input.config, errorMessage);
        return { ok: false, errorMessage, statusCode: response.status };
      }

      const responseContent = message.content ? String(message.content) : '';
      this.metrics.consecutiveFailures = 0;
      this.metrics.lastError = null;
      this.currentModelId = input.config.id;
      this.clearModelCooldown(input.config.id);
      this.trackUsageSuccess(input.config.id);
      this.budgetGovernor.recordUsage({
        sessionId: input.sessionId,
        modelId: input.config.id,
        providerId: input.providerId,
        profile: input.directive.profile,
        stage: 'success',
        requestTokens: input.estimatedRequestTokens,
        responseTokens: estimateTokenCount(responseContent),
        latencyMs,
        statusCode: response.status,
      });
      this.recordEvent('success', input.config, `Response succeeded for ${input.config.id}.`);
      return { ok: true, message, statusCode: response.status };
    } catch (error) {
      const latencyMs = this.nowFn() - startedAt;
      const message = scrubSensitiveText(error instanceof Error ? error.message : String(error));
      this.#recordFailure(message);
      this.trackUsageFailure(input.config.id, message);
      this.budgetGovernor.recordUsage({
        sessionId: input.sessionId,
        modelId: input.config.id,
        providerId: input.providerId,
        profile: input.directive.profile,
        stage: 'failure',
        requestTokens: input.estimatedRequestTokens,
        responseTokens: 0,
        latencyMs,
        error: message,
      });
      this.recordEvent('failure', input.config, `Transport error on ${input.config.id}: ${message}`);
      return { ok: false, errorMessage: message };
    }
  }

  private getOrderedModels(profile: RuntimeBudgetProfile): ModelConfig[] {
    if (!this.models.length) {
      return [];
    }

    const preferred = this.getPreferredOrdering();
    if (profile === 'economy') {
      return [...preferred].sort((a, b) => this.getCostRank(a.id) - this.getCostRank(b.id));
    }
    if (profile === 'balanced') {
      return [...preferred].sort((a, b) => this.getBalancedRank(a.id) - this.getBalancedRank(b.id));
    }
    return preferred;
  }

  private getPreferredOrdering(): ModelConfig[] {
    if (this.preferredModelIndex <= 0) {
      return [...this.models];
    }
    return [
      ...this.models.slice(this.preferredModelIndex),
      ...this.models.slice(0, this.preferredModelIndex),
    ];
  }

  private getCostRank(modelId: string): number {
    if (modelId === 'fallback_2') return 1;
    if (modelId === 'fallback_1') return 2;
    if (modelId === 'primary') return 3;
    return 4;
  }

  private getBalancedRank(modelId: string): number {
    if (modelId === 'fallback_1') return 1;
    if (modelId === 'primary') return 2;
    if (modelId === 'fallback_2') return 3;
    return 4;
  }

  private resolveProviderId(config: ModelConfig): string {
    const url = config.baseURL.toLowerCase();
    if (url.includes('openrouter.ai')) return 'openrouter';
    if (url.includes('generativelanguage.googleapis.com')) return 'google';
    if (url.includes('modal.direct')) return 'modal';
    return 'unknown';
  }

  private getModelCooldownState(modelId: string): { remainingMs: number; reason: string | null } {
    const usage = this.usageByModel.get(modelId);
    if (!usage?.cooldownUntilMs) {
      return { remainingMs: 0, reason: usage?.cooldownReason ?? null };
    }

    const remainingMs = Math.max(0, usage.cooldownUntilMs - this.nowFn());
    if (remainingMs === 0) {
      usage.cooldownUntilMs = null;
      usage.cooldownReason = null;
    }
    return { remainingMs, reason: usage.cooldownReason };
  }

  private setModelCooldown(modelId: string, cooldownMs: number, reason: string): void {
    const usage = this.usageByModel.get(modelId);
    if (!usage) {
      return;
    }
    usage.cooldownUntilMs = this.nowFn() + Math.max(0, cooldownMs);
    usage.cooldownReason = reason;
    this.recordEvent(
      'cooldown_set',
      this.models.find((model) => model.id === modelId) ?? null,
      `Cooldown set for ${modelId}: ${cooldownMs}ms (${reason}).`,
    );
  }

  private clearModelCooldown(modelId: string): void {
    const usage = this.usageByModel.get(modelId);
    if (!usage) {
      return;
    }
    usage.cooldownUntilMs = null;
    usage.cooldownReason = null;
  }

  private trackUsageAttempt(modelId: string): void {
    const usage = this.usageByModel.get(modelId);
    if (!usage) {
      return;
    }
    usage.attempts += 1;
    usage.lastUsedAt = new Date(this.nowFn()).toISOString();
  }

  private trackUsageSuccess(modelId: string): void {
    const usage = this.usageByModel.get(modelId);
    if (!usage) {
      return;
    }
    usage.successes += 1;
    usage.lastError = null;
  }

  private trackUsageFailure(modelId: string, message: string, rateLimited = false): void {
    const usage = this.usageByModel.get(modelId);
    if (!usage) {
      return;
    }
    usage.failures += 1;
    usage.lastError = scrubSensitiveText(message);
    if (rateLimited) {
      usage.rateLimits += 1;
    }
  }

  private getActiveCooldowns(): ModelRoutingCooldownSnapshot[] {
    const now = this.nowFn();
    const result: ModelRoutingCooldownSnapshot[] = [];
    for (const model of this.models) {
      const usage = this.usageByModel.get(model.id);
      if (!usage?.cooldownUntilMs || usage.cooldownUntilMs <= now) {
        continue;
      }
      result.push({
        modelId: model.id,
        modelName: model.model,
        provider: usage.provider,
        reason: usage.cooldownReason ?? 'cooldown',
        remainingMs: usage.cooldownUntilMs - now,
        until: new Date(usage.cooldownUntilMs).toISOString(),
      });
    }
    return result.sort((a, b) => b.remainingMs - a.remainingMs);
  }

  private buildOperatorGuidance(cooldowns: ModelRoutingCooldownSnapshot[]): string[] {
    const guidance: string[] = [];
    if (cooldowns.length >= this.models.length) {
      const nextReadyMs = Math.min(...cooldowns.map((cooldown) => cooldown.remainingMs));
      guidance.push(`All providers cooling down. Next model availability in ~${Math.ceil(nextReadyMs / 1000)}s.`);
    }

    if (this.metrics.consecutiveFailures >= 3) {
      guidance.push(
        `Routing instability detected (${this.metrics.consecutiveFailures} consecutive failures). Validate quotas and provider credentials.`,
      );
    }

    if (this.fallbackMode === 'intelligent_pacing' && cooldowns.length > 0) {
      guidance.push('Fallback mode intelligent_pacing is active: waiting briefly before provider switching.');
    }

    if (this.fallbackMode === 'aggressive_fallback' && this.metrics.failoverCount > 0) {
      guidance.push('Fallback mode aggressive_fallback is active: immediate provider switching enabled.');
    }

    if (guidance.length === 0) {
      guidance.push('Routing stable. No active model cooldown pressure detected.');
    }
    return guidance.map((item) => scrubSensitiveText(item));
  }

  private recordEvent(type: ModelRoutingEventType, model: ModelConfig | null, detail: string): void {
    const event: ModelRoutingEventSnapshot = {
      id: randomUUID(),
      type,
      modelId: model?.id ?? null,
      modelName: model?.model ?? null,
      provider: model ? this.resolveProviderId(model) : null,
      fallbackMode: this.fallbackMode,
      detail: scrubSensitiveText(detail),
      createdAt: new Date(this.nowFn()).toISOString(),
    };

    this.runtimeEvents.unshift(event);
    if (this.runtimeEvents.length > this.maxRuntimeEvents) {
      this.runtimeEvents.splice(this.maxRuntimeEvents);
    }

    try {
      saveModelRoutingEvent(
        {
          id: event.id,
          eventType: event.type,
          modelId: event.modelId,
          modelName: event.modelName,
          provider: event.provider,
          fallbackMode: event.fallbackMode,
          detailJson: JSON.stringify({ detail: event.detail }),
          createdAt: event.createdAt,
        },
        this.maxPersistedEvents,
      );
    } catch (error) {
      const message = scrubSensitiveText(error instanceof Error ? error.message : String(error));
      console.warn(`[Router] Failed to persist model routing telemetry: ${message}`);
    }
  }

  #recordFailure(message: string): void {
    this.metrics.totalFailures += 1;
    this.metrics.consecutiveFailures += 1;
    this.metrics.lastError = scrubSensitiveText(message);
    this.metrics.lastFailureAt = new Date(this.nowFn()).toISOString();
  }
}

function estimateRequestTokens(messages: Message[], tools: unknown): number {
  const messageTokens = messages.reduce((sum, message) => sum + estimateTokenCount(message.content ?? ''), 0);
  const toolTokens = tools ? estimateTokenCount(JSON.stringify(tools)) : 0;
  return messageTokens + toolTokens;
}

function estimateTokenCount(content: string): number {
  if (!content) {
    return 0;
  }
  return Math.max(1, Math.ceil(content.length / CHARS_PER_TOKEN));
}

async function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}
