import { randomUUID } from 'node:crypto';
import { scrubSensitiveText } from '../utils/logger.js';
import { getModelRoutingSetting, listModelRoutingEvents, saveModelRoutingEvent, saveModelRoutingSetting, } from './db.js';
import { getSecretVaultService } from './secret-vault.js';
import { RuntimeBudgetGovernor } from './runtime-budget-governor.js';
const CHARS_PER_TOKEN = 4;
const DEFAULT_SESSION_ID = 'global';
const FALLBACK_MODE_SETTING_KEY = 'fallback_mode';
const DEFAULT_FALLBACK_MODE = 'aggressive_fallback';
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000;
const DEFAULT_INTELLIGENT_PACING_MAX_WAIT_MS = 5_000;
const DEFAULT_MAX_RUNTIME_EVENTS = 120;
const DEFAULT_MAX_PERSISTED_EVENTS = 500;
const DEFAULT_BOOTSTRAP_EVENT_COUNT = 30;
function isFallbackMode(value) {
    return value === 'intelligent_pacing' || value === 'aggressive_fallback';
}
function parseRetryAfterMs(rawHeader) {
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
function parseEventDetail(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.detail === 'string') {
            return parsed.detail;
        }
    }
    catch {
        // fall through
    }
    return raw;
}
export class ModelRouter {
    models;
    preferredModelIndex = 0;
    budgetGovernor;
    usageByModel = new Map();
    runtimeEvents = [];
    nowFn;
    sleepFn;
    defaultRateLimitCooldownMs;
    intelligentPacingMaxWaitMs;
    maxRuntimeEvents;
    maxPersistedEvents;
    fallbackMode;
    currentModelId = null;
    metrics = {
        totalRequests: 0,
        totalFailures: 0,
        consecutiveFailures: 0,
        failoverCount: 0,
        lastError: null,
        lastFailureAt: null,
    };
    constructor(options = {}) {
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
        this.defaultRateLimitCooldownMs = Math.max(1_000, Math.floor(options.defaultRateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS));
        this.intelligentPacingMaxWaitMs = Math.max(0, Math.floor(options.intelligentPacingMaxWaitMs ?? DEFAULT_INTELLIGENT_PACING_MAX_WAIT_MS));
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
    getFallbackMode() {
        return this.fallbackMode;
    }
    setFallbackMode(mode) {
        if (mode === this.fallbackMode) {
            return this.getHealthSnapshot();
        }
        const previousMode = this.fallbackMode;
        this.fallbackMode = mode;
        this.persistFallbackMode(mode);
        this.recordEvent('mode_change', null, `Fallback mode changed ${previousMode} -> ${mode}.`);
        return this.getHealthSnapshot();
    }
    getHealthSnapshot() {
        const activeCooldowns = this.getActiveCooldowns();
        const usage = this.models
            .map((model) => this.usageByModel.get(model.id))
            .filter((entry) => Boolean(entry))
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
    getBudgetSnapshot(sessionId) {
        return this.budgetGovernor.getSnapshot(sessionId ?? DEFAULT_SESSION_ID, 80);
    }
    setBudgetProfile(profile, sessionId) {
        this.budgetGovernor.setManualProfile(profile, sessionId ?? DEFAULT_SESSION_ID);
    }
    resetBudgetPolicyState(sessionId) {
        this.budgetGovernor.resetPolicyState(sessionId ?? DEFAULT_SESSION_ID);
    }
    forceFailover() {
        const previousModelId = this.models[this.preferredModelIndex]?.id ?? null;
        if (!this.models.length) {
            return { previousModelId, nextModelId: null };
        }
        this.preferredModelIndex = (this.preferredModelIndex + 1) % this.models.length;
        this.metrics.failoverCount += 1;
        const nextModelId = this.models[this.preferredModelIndex]?.id ?? null;
        this.recordEvent('failover', this.models[this.preferredModelIndex] ?? null, `Forced failover applied: ${previousModelId ?? 'none'} -> ${nextModelId ?? 'none'}.`);
        console.log(`[Router] Forced failover applied: ${previousModelId} -> ${nextModelId}`);
        return { previousModelId, nextModelId };
    }
    resetPreferredModel() {
        this.preferredModelIndex = 0;
    }
    async createChatCompletion(messages, tools, context = {}) {
        let lastError = null;
        let lastTriedModelId = null;
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
                this.recordEvent('cooldown_skip', config, `Skipped by runtime budget policy (${directive.severity}).`);
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
            const payload = {
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
            if (firstAttempt.statusCode === 429 &&
                this.fallbackMode === 'intelligent_pacing' &&
                typeof firstAttempt.rateLimitCooldownMs === 'number') {
                const retryWaitMs = Math.min(firstAttempt.rateLimitCooldownMs, this.intelligentPacingMaxWaitMs);
                if (retryWaitMs > 0) {
                    this.recordEvent('cooldown_wait', config, `Intelligent pacing wait ${retryWaitMs}ms before retrying ${config.id}.`);
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
                }
                else {
                    this.recordEvent('cooldown_skip', config, `Retry skipped; cooldown still active for ${retryCooldown.remainingMs}ms.`);
                }
            }
            if (firstAttempt.errorMessage) {
                lastError = new Error(firstAttempt.errorMessage);
            }
            lastTriedModelId = config.id;
        }
        throw new Error(`All configured models exhausted or failed. Last error: ${scrubSensitiveText(lastError?.message ?? 'unknown')}`);
    }
    getApiKey(envName) {
        const key = getSecretVaultService().readSecret(envName);
        if (!key) {
            console.warn(`Warning: API key ${envName} is not set in environment.`);
            return '';
        }
        return key;
    }
    resolveInitialFallbackMode(override) {
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
    persistFallbackMode(mode) {
        try {
            saveModelRoutingSetting(FALLBACK_MODE_SETTING_KEY, mode);
        }
        catch (error) {
            const message = scrubSensitiveText(error instanceof Error ? error.message : String(error));
            console.warn(`[Router] Failed to persist fallback mode: ${message}`);
        }
    }
    hydrateRecentEvents() {
        try {
            const rows = listModelRoutingEvents(Math.min(this.maxRuntimeEvents, DEFAULT_BOOTSTRAP_EVENT_COUNT));
            this.runtimeEvents.push(...rows.map((row) => ({
                id: row.id,
                type: row.event_type,
                modelId: row.model_id,
                modelName: row.model_name,
                provider: row.provider,
                fallbackMode: row.fallback_mode,
                detail: scrubSensitiveText(parseEventDetail(row.detail_json)),
                createdAt: row.created_at,
            })));
        }
        catch (error) {
            const message = scrubSensitiveText(error instanceof Error ? error.message : String(error));
            console.warn(`[Router] Failed to hydrate model routing events: ${message}`);
        }
    }
    async resolveCooldownPreflight(config) {
        const cooldown = this.getModelCooldownState(config.id);
        if (cooldown.remainingMs <= 0) {
            return true;
        }
        if (this.fallbackMode === 'aggressive_fallback') {
            this.recordEvent('cooldown_skip', config, `Skipped ${config.id}; cooldown active for ${cooldown.remainingMs}ms.`);
            return false;
        }
        const waitMs = Math.min(cooldown.remainingMs, this.intelligentPacingMaxWaitMs);
        if (waitMs > 0) {
            this.recordEvent('cooldown_wait', config, `Waiting ${waitMs}ms for ${config.id} cooldown.`);
            await this.sleepFn(waitMs);
        }
        const postWaitCooldown = this.getModelCooldownState(config.id);
        if (postWaitCooldown.remainingMs > 0) {
            this.recordEvent('cooldown_skip', config, `Cooldown for ${config.id} remains active (${postWaitCooldown.remainingMs}ms).`);
            return false;
        }
        return true;
    }
    async executeHttpAttempt(input) {
        this.metrics.totalRequests += 1;
        this.trackUsageAttempt(input.config.id);
        this.recordEvent('attempt', input.config, `Attempting ${input.config.model} (profile=${input.directive.profile}, severity=${input.directive.severity}).`);
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
                const cooldownMs = parseRetryAfterMs(response.headers.get('retry-after')) ?? this.defaultRateLimitCooldownMs;
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
                this.budgetGovernor.applyProviderCooldown(input.providerId, input.sessionId, 'Provider returned 429; cooldown activated.');
                this.setModelCooldown(input.config.id, cooldownMs, '429 rate-limit');
                this.recordEvent('rate_limit', input.config, `Rate limit on ${input.config.id}; cooldown=${cooldownMs}ms; mode=${this.fallbackMode}.`);
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
            const data = await response.json();
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
        }
        catch (error) {
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
    getOrderedModels(profile) {
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
    getPreferredOrdering() {
        if (this.preferredModelIndex <= 0) {
            return [...this.models];
        }
        return [
            ...this.models.slice(this.preferredModelIndex),
            ...this.models.slice(0, this.preferredModelIndex),
        ];
    }
    getCostRank(modelId) {
        if (modelId === 'fallback_2')
            return 1;
        if (modelId === 'fallback_1')
            return 2;
        if (modelId === 'primary')
            return 3;
        return 4;
    }
    getBalancedRank(modelId) {
        if (modelId === 'fallback_1')
            return 1;
        if (modelId === 'primary')
            return 2;
        if (modelId === 'fallback_2')
            return 3;
        return 4;
    }
    resolveProviderId(config) {
        const url = config.baseURL.toLowerCase();
        if (url.includes('openrouter.ai'))
            return 'openrouter';
        if (url.includes('generativelanguage.googleapis.com'))
            return 'google';
        if (url.includes('modal.direct'))
            return 'modal';
        return 'unknown';
    }
    getModelCooldownState(modelId) {
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
    setModelCooldown(modelId, cooldownMs, reason) {
        const usage = this.usageByModel.get(modelId);
        if (!usage) {
            return;
        }
        usage.cooldownUntilMs = this.nowFn() + Math.max(0, cooldownMs);
        usage.cooldownReason = reason;
        this.recordEvent('cooldown_set', this.models.find((model) => model.id === modelId) ?? null, `Cooldown set for ${modelId}: ${cooldownMs}ms (${reason}).`);
    }
    clearModelCooldown(modelId) {
        const usage = this.usageByModel.get(modelId);
        if (!usage) {
            return;
        }
        usage.cooldownUntilMs = null;
        usage.cooldownReason = null;
    }
    trackUsageAttempt(modelId) {
        const usage = this.usageByModel.get(modelId);
        if (!usage) {
            return;
        }
        usage.attempts += 1;
        usage.lastUsedAt = new Date(this.nowFn()).toISOString();
    }
    trackUsageSuccess(modelId) {
        const usage = this.usageByModel.get(modelId);
        if (!usage) {
            return;
        }
        usage.successes += 1;
        usage.lastError = null;
    }
    trackUsageFailure(modelId, message, rateLimited = false) {
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
    getActiveCooldowns() {
        const now = this.nowFn();
        const result = [];
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
    buildOperatorGuidance(cooldowns) {
        const guidance = [];
        if (cooldowns.length >= this.models.length) {
            const nextReadyMs = Math.min(...cooldowns.map((cooldown) => cooldown.remainingMs));
            guidance.push(`All providers cooling down. Next model availability in ~${Math.ceil(nextReadyMs / 1000)}s.`);
        }
        if (this.metrics.consecutiveFailures >= 3) {
            guidance.push(`Routing instability detected (${this.metrics.consecutiveFailures} consecutive failures). Validate quotas and provider credentials.`);
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
    recordEvent(type, model, detail) {
        const event = {
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
            saveModelRoutingEvent({
                id: event.id,
                eventType: event.type,
                modelId: event.modelId,
                modelName: event.modelName,
                provider: event.provider,
                fallbackMode: event.fallbackMode,
                detailJson: JSON.stringify({ detail: event.detail }),
                createdAt: event.createdAt,
            }, this.maxPersistedEvents);
        }
        catch (error) {
            const message = scrubSensitiveText(error instanceof Error ? error.message : String(error));
            console.warn(`[Router] Failed to persist model routing telemetry: ${message}`);
        }
    }
    #recordFailure(message) {
        this.metrics.totalFailures += 1;
        this.metrics.consecutiveFailures += 1;
        this.metrics.lastError = scrubSensitiveText(message);
        this.metrics.lastFailureAt = new Date(this.nowFn()).toISOString();
    }
}
function estimateRequestTokens(messages, tools) {
    const messageTokens = messages.reduce((sum, message) => sum + estimateTokenCount(message.content ?? ''), 0);
    const toolTokens = tools ? estimateTokenCount(JSON.stringify(tools)) : 0;
    return messageTokens + toolTokens;
}
function estimateTokenCount(content) {
    if (!content) {
        return 0;
    }
    return Math.max(1, Math.ceil(content.length / CHARS_PER_TOKEN));
}
async function sleep(ms) {
    if (!Number.isFinite(ms) || ms <= 0) {
        return;
    }
    await new Promise((resolve) => {
        setTimeout(() => resolve(), ms);
    });
}
