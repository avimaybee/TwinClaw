import { randomUUID } from 'node:crypto';
import type { Gateway } from '../core/gateway.js';
import type {
  CallbackOutcomeCounts,
  IncidentEvidence,
  IncidentRecord,
  IncidentRemediationAction,
  IncidentSeverity,
  IncidentStatus,
  IncidentTimelineEntry,
  IncidentType,
} from '../types/incident.js';
import type { JobScheduler } from './job-scheduler.js';
import type { ModelRouter, ModelRoutingHealthSnapshot } from './model-router.js';
import type { QueueService, QueueProcessingMode } from './queue-service.js';
import {
  appendIncidentTimelineEntry,
  getCallbackOutcomeCounts,
  listIncidentRecords,
  listIncidentTimeline,
  upsertIncidentRecord,
  type IncidentRecordRow,
  type IncidentTimelineRow,
} from './db.js';
import { logThought } from '../utils/logger.js';
import { getConfigValue } from '../config/config-loader.js';

const INCIDENT_JOB_ID = 'incident-self-healing';

const DEFAULT_CONFIG = {
  pollCronExpression: '*/20 * * * * *',
  queueDepthThreshold: 25,
  queueFailureThreshold: 10,
  callbackFailureBurstThreshold: 4,
  callbackWindowMinutes: 5,
  contextDegradationThreshold: 3,
  modelRoutingFailureThreshold: 3,
  remediationCooldownMs: 60_000,
  maxRemediationAttempts: 3,
} as const;

export interface IncidentManagerConfig {
  pollCronExpression?: string;
  queueDepthThreshold?: number;
  queueFailureThreshold?: number;
  callbackFailureBurstThreshold?: number;
  callbackWindowMinutes?: number;
  contextDegradationThreshold?: number;
  modelRoutingFailureThreshold?: number;
  remediationCooldownMs?: number;
  maxRemediationAttempts?: number;
}

export interface IncidentManagerDeps {
  gateway: Gateway;
  router: ModelRouter;
  queue?: QueueService;
  scheduler?: JobScheduler;
  config?: IncidentManagerConfig;
}

interface IncidentSignalSnapshot {
  queue: {
    totalQueued: number;
    totalFailed: number;
    totalDispatching: number;
    totalDeadLetters: number;
  } | null;
  callbackTotals: CallbackOutcomeCounts;
  callbackDelta: CallbackOutcomeCounts;
  context: ReturnType<Gateway['getContextDegradationSnapshot']>;
  modelRouting: ModelRoutingHealthSnapshot;
}

interface DetectedIncident {
  type: IncidentType;
  severity: IncidentSeverity;
  summary: string;
  evidence: IncidentEvidence[];
}

interface ActiveIncidentState {
  id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  remediationAttempts: number;
  remediationAction: IncidentRemediationAction;
  cooldownUntil: number | null;
  summary: string;
  evidence: IncidentEvidence[];
  recommendedActions: string[];
  rollbackStack: Array<() => void>;
}

interface RemediationResult {
  action: IncidentRemediationAction;
  detail: string;
  succeeded: boolean;
  rollback?: () => void;
}

export class IncidentManager {
  readonly #gateway: Gateway;
  readonly #router: ModelRouter;
  readonly #queue?: QueueService;
  readonly #scheduler?: JobScheduler;
  readonly #config: Required<IncidentManagerConfig>;
  readonly #active: Map<IncidentType, ActiveIncidentState> = new Map();
  #callbackTotalsBaseline: CallbackOutcomeCounts = {
    accepted: 0,
    duplicate: 0,
    rejected: 0,
  };
  #safeMode = false;

  constructor(deps: IncidentManagerDeps) {
    this.#gateway = deps.gateway;
    this.#router = deps.router;
    this.#queue = deps.queue;
    this.#scheduler = deps.scheduler;
    this.#config = {
      pollCronExpression:
        deps.config?.pollCronExpression ??
        getConfigValue('INCIDENT_POLL_CRON') ??
        DEFAULT_CONFIG.pollCronExpression,
      queueDepthThreshold:
        deps.config?.queueDepthThreshold ??
        readNumberEnv('INCIDENT_QUEUE_DEPTH_THRESHOLD', DEFAULT_CONFIG.queueDepthThreshold),
      queueFailureThreshold:
        deps.config?.queueFailureThreshold ??
        readNumberEnv('INCIDENT_QUEUE_FAILURE_THRESHOLD', DEFAULT_CONFIG.queueFailureThreshold),
      callbackFailureBurstThreshold:
        deps.config?.callbackFailureBurstThreshold ??
        readNumberEnv('INCIDENT_CALLBACK_BURST_THRESHOLD', DEFAULT_CONFIG.callbackFailureBurstThreshold),
      callbackWindowMinutes:
        deps.config?.callbackWindowMinutes ??
        readNumberEnv('INCIDENT_CALLBACK_WINDOW_MINUTES', DEFAULT_CONFIG.callbackWindowMinutes),
      contextDegradationThreshold:
        deps.config?.contextDegradationThreshold ??
        readNumberEnv('INCIDENT_CONTEXT_DEGRADATION_THRESHOLD', DEFAULT_CONFIG.contextDegradationThreshold),
      modelRoutingFailureThreshold:
        deps.config?.modelRoutingFailureThreshold ??
        readNumberEnv('INCIDENT_ROUTING_FAILURE_THRESHOLD', DEFAULT_CONFIG.modelRoutingFailureThreshold),
      remediationCooldownMs:
        deps.config?.remediationCooldownMs ??
        readNumberEnv('INCIDENT_REMEDIATION_COOLDOWN_MS', DEFAULT_CONFIG.remediationCooldownMs),
      maxRemediationAttempts:
        deps.config?.maxRemediationAttempts ??
        readNumberEnv('INCIDENT_MAX_REMEDIATION_ATTEMPTS', DEFAULT_CONFIG.maxRemediationAttempts),
    };
  }

  start(): void {
    if (!this.#scheduler || this.#scheduler.getJob(INCIDENT_JOB_ID)) {
      return;
    }

    this.#scheduler.register({
      id: INCIDENT_JOB_ID,
      cronExpression: this.#config.pollCronExpression,
      description: 'Detect incidents and apply self-healing playbooks',
      handler: async () => {
        this.evaluateNow();
      },
      autoStart: true,
    });
  }

  stop(): void {
    this.#scheduler?.unregister(INCIDENT_JOB_ID);
  }

  isSafeModeEnabled(): boolean {
    return this.#safeMode;
  }

  evaluateNow(): IncidentRecord[] {
    const snapshot = this.#collectSignals();
    const detections = this.#detect(snapshot);
    const detectedTypes = new Set(detections.map((detection) => detection.type));

    for (const detection of detections) {
      this.#handleDetection(detection);
    }

    for (const [type, state] of this.#active.entries()) {
      if (!detectedTypes.has(type)) {
        this.#resolveIncident(state, 'Signals returned below thresholds.');
      }
    }

    return this.getCurrentIncidents();
  }

  getCurrentIncidents(): IncidentRecord[] {
    const rows = listIncidentRecords(100, ['active', 'remediating', 'escalated']);
    return rows.map((row) => this.#toIncidentRecord(row));
  }

  getIncidentHistory(limit = 200): IncidentRecord[] {
    const rows = listIncidentRecords(limit);
    return rows.map((row) => this.#toIncidentRecord(row));
  }

  getIncidentTimeline(limit = 300): IncidentTimelineEntry[] {
    const rows = listIncidentTimeline(limit);
    return rows.map((row) => this.#toTimelineEntry(row));
  }

  #collectSignals(): IncidentSignalSnapshot {
    const queueStatsRaw = this.#queue?.getStats();
    const queue =
      queueStatsRaw
        ? {
          totalQueued: Number(queueStatsRaw.totalQueued ?? 0),
          totalFailed: Number(queueStatsRaw.totalFailed ?? 0),
          totalDispatching: Number(queueStatsRaw.totalDispatching ?? 0),
          totalDeadLetters: Number(queueStatsRaw.totalDeadLetters ?? 0),
        }
        : null;

    const callbackTotals = getCallbackOutcomeCounts(this.#config.callbackWindowMinutes);
    const callbackDelta: CallbackOutcomeCounts = {
      accepted: Math.max(0, callbackTotals.accepted - this.#callbackTotalsBaseline.accepted),
      duplicate: Math.max(0, callbackTotals.duplicate - this.#callbackTotalsBaseline.duplicate),
      rejected: Math.max(0, callbackTotals.rejected - this.#callbackTotalsBaseline.rejected),
    };
    this.#callbackTotalsBaseline = callbackTotals;

    return {
      queue,
      callbackTotals,
      callbackDelta,
      context: this.#gateway.getContextDegradationSnapshot(),
      modelRouting: this.#router.getHealthSnapshot(),
    };
  }

  #detect(snapshot: IncidentSignalSnapshot): DetectedIncident[] {
    const detections: DetectedIncident[] = [];

    if (
      snapshot.queue &&
      (snapshot.queue.totalQueued + snapshot.queue.totalDispatching >= this.#config.queueDepthThreshold ||
        snapshot.queue.totalFailed + snapshot.queue.totalDeadLetters >= this.#config.queueFailureThreshold)
    ) {
      detections.push({
        type: 'queue_backpressure',
        severity:
          snapshot.queue.totalDeadLetters > 0 || snapshot.queue.totalFailed > this.#config.queueFailureThreshold
            ? 'critical'
            : 'warning',
        summary:
          `Queue backlog=${snapshot.queue.totalQueued + snapshot.queue.totalDispatching}, ` +
          `failures=${snapshot.queue.totalFailed}, deadLetters=${snapshot.queue.totalDeadLetters}.`,
        evidence: [
          {
            signal: 'queue_depth',
            observedValue: snapshot.queue.totalQueued + snapshot.queue.totalDispatching,
            threshold: this.#config.queueDepthThreshold,
          },
          {
            signal: 'queue_failures',
            observedValue: snapshot.queue.totalFailed + snapshot.queue.totalDeadLetters,
            threshold: this.#config.queueFailureThreshold,
          },
        ],
      });
    }

    if (snapshot.callbackDelta.rejected >= this.#config.callbackFailureBurstThreshold) {
      detections.push({
        type: 'callback_failure_storm',
        severity: 'critical',
        summary:
          `Callback rejection burst detected (+${snapshot.callbackDelta.rejected} in the latest window).`,
        evidence: [
          {
            signal: 'callback_rejected_delta',
            observedValue: snapshot.callbackDelta.rejected,
            threshold: this.#config.callbackFailureBurstThreshold,
            metadata: {
              accepted: snapshot.callbackTotals.accepted,
              duplicate: snapshot.callbackTotals.duplicate,
              rejected: snapshot.callbackTotals.rejected,
            },
          },
        ],
      });
    }

    if (snapshot.context.maxConsecutiveDegradation >= this.#config.contextDegradationThreshold) {
      detections.push({
        type: 'context_budget_degradation',
        severity: 'warning',
        summary:
          `Context degradation sustained for ${snapshot.context.maxConsecutiveDegradation} consecutive turns.`,
        evidence: [
          {
            signal: 'context_degradation_consecutive',
            observedValue: snapshot.context.maxConsecutiveDegradation,
            threshold: this.#config.contextDegradationThreshold,
            metadata: {
              degradedSessions: snapshot.context.degradedSessions,
              sessions: snapshot.context.sessions,
            },
          },
        ],
      });
    }

    if (snapshot.modelRouting.consecutiveFailures >= this.#config.modelRoutingFailureThreshold) {
      detections.push({
        type: 'model_routing_instability',
        severity: 'critical',
        summary:
          `Model router has ${snapshot.modelRouting.consecutiveFailures} consecutive failures (last error: ` +
          `${snapshot.modelRouting.lastError ?? 'unknown'}).`,
        evidence: [
          {
            signal: 'model_router_consecutive_failures',
            observedValue: snapshot.modelRouting.consecutiveFailures,
            threshold: this.#config.modelRoutingFailureThreshold,
            metadata: {
              preferredModelId: snapshot.modelRouting.preferredModelId,
              failoverCount: snapshot.modelRouting.failoverCount,
            },
          },
        ],
      });
    }

    return detections;
  }

  #handleDetection(detection: DetectedIncident): void {
    const existing = this.#active.get(detection.type);
    const state =
      existing ??
      {
        id: randomUUID(),
        type: detection.type,
        severity: detection.severity,
        status: 'active' as IncidentStatus,
        remediationAttempts: 0,
        remediationAction: 'none' as IncidentRemediationAction,
        cooldownUntil: null,
        summary: detection.summary,
        evidence: detection.evidence,
        recommendedActions: [],
        rollbackStack: [],
      };

    state.severity = detection.severity;
    state.summary = detection.summary;
    state.evidence = detection.evidence;
    this.#active.set(detection.type, state);

    if (!existing) {
      this.#persist(state);
      this.#appendTimeline(state, 'detected', { summary: detection.summary, evidence: detection.evidence });
    }

    if (state.status === 'escalated') {
      this.#persist(state);
      return;
    }

    const now = Date.now();
    if (state.cooldownUntil && state.cooldownUntil > now) {
      state.status = 'remediating';
      this.#persist(state);
      this.#appendTimeline(state, 'cooldown_active', {
        cooldownUntil: new Date(state.cooldownUntil).toISOString(),
        remainingMs: state.cooldownUntil - now,
      });
      return;
    }

    if (state.remediationAttempts >= this.#config.maxRemediationAttempts) {
      this.#escalate(state, 'Maximum remediation attempts exceeded.');
      return;
    }

    const remediation = this.#runPlaybook(state);
    state.remediationAttempts += 1;
    state.remediationAction = remediation.action;
    state.cooldownUntil = Date.now() + this.#config.remediationCooldownMs;

    if (remediation.rollback) {
      state.rollbackStack.push(remediation.rollback);
    }

    if (remediation.succeeded) {
      state.status = 'remediating';
      this.#persist(state);
      this.#appendTimeline(state, 'remediation_applied', {
        action: remediation.action,
        detail: remediation.detail,
        attempt: state.remediationAttempts,
        cooldownUntil: new Date(state.cooldownUntil).toISOString(),
      });
      void logThought(`[IncidentManager] ${state.type}: applied remediation '${remediation.action}'.`);
      return;
    }

    this.#appendTimeline(state, 'remediation_failed', {
      action: remediation.action,
      detail: remediation.detail,
      attempt: state.remediationAttempts,
    });
    this.#escalate(state, remediation.detail);
  }

  #runPlaybook(state: ActiveIncidentState): RemediationResult {
    const action = this.#selectAction(state.type, state.remediationAttempts + 1);

    switch (action) {
      case 'throttle': {
        if (!this.#queue) {
          return { action, detail: 'Queue service unavailable; cannot throttle.', succeeded: false };
        }
        const previousMode = this.#queue.getRuntimeControls().mode;
        this.#queue.setProcessingMode('throttled');
        return {
          action,
          detail: `Queue mode changed ${previousMode} -> throttled.`,
          succeeded: true,
          rollback: () => this.#queue?.setProcessingMode(previousMode),
        };
      }
      case 'drain': {
        if (!this.#queue) {
          return { action, detail: 'Queue service unavailable; cannot drain.', succeeded: false };
        }
        const previousMode = this.#queue.getRuntimeControls().mode;
        this.#queue.setProcessingMode('drain');
        return {
          action,
          detail: `Queue mode changed ${previousMode} -> drain.`,
          succeeded: true,
          rollback: () => this.#queue?.setProcessingMode(previousMode),
        };
      }
      case 'retry_window_adjustment': {
        if (!this.#queue) {
          return { action, detail: 'Queue service unavailable; cannot adjust retry window.', succeeded: false };
        }
        const controls = this.#queue.getRuntimeControls();
        const previousMultiplier = controls.retryWindowMultiplier;
        const nextMultiplier = Math.min(previousMultiplier * 1.5, 6);
        this.#queue.setRetryWindowMultiplier(nextMultiplier);
        return {
          action,
          detail: `Retry window multiplier changed ${previousMultiplier} -> ${nextMultiplier}.`,
          succeeded: true,
          rollback: () => this.#queue?.setRetryWindowMultiplier(previousMultiplier),
        };
      }
      case 'failover': {
        const shift = this.#router.forceFailover();
        return {
          action,
          detail: `Model routing failover applied ${shift.previousModelId ?? 'none'} -> ${shift.nextModelId ?? 'none'}.`,
          succeeded: true,
          rollback: () => this.#router.resetPreferredModel(),
        };
      }
      case 'halt_safe_mode': {
        const previousSafeMode = this.#safeMode;
        this.#safeMode = true;
        const previousQueueMode: QueueProcessingMode | null = this.#queue?.getRuntimeControls().mode ?? null;
        this.#queue?.setProcessingMode('throttled');
        return {
          action,
          detail: 'Entered safe mode and throttled queue processing.',
          succeeded: true,
          rollback: () => {
            this.#safeMode = previousSafeMode;
            if (previousQueueMode) {
              this.#queue?.setProcessingMode(previousQueueMode);
            }
          },
        };
      }
      default:
        return { action: 'none', detail: 'No remediation action selected.', succeeded: false };
    }
  }

  #selectAction(type: IncidentType, attempt: number): IncidentRemediationAction {
    if (type === 'queue_backpressure') {
      if (attempt === 1) return 'throttle';
      if (attempt === 2) return 'drain';
      return 'halt_safe_mode';
    }

    if (type === 'callback_failure_storm') {
      if (attempt === 1) return 'retry_window_adjustment';
      if (attempt === 2) return 'throttle';
      return 'halt_safe_mode';
    }

    if (type === 'context_budget_degradation') {
      if (attempt === 1) return 'retry_window_adjustment';
      return 'halt_safe_mode';
    }

    if (type === 'model_routing_instability') {
      if (attempt <= 2) return 'failover';
      return 'halt_safe_mode';
    }

    return 'none';
  }

  #resolveIncident(state: ActiveIncidentState, reason: string): void {
    const rollbacks = [...state.rollbackStack].reverse();
    const rollbackFailures: string[] = [];

    for (const rollback of rollbacks) {
      try {
        rollback();
      } catch (err) {
        rollbackFailures.push(err instanceof Error ? err.message : String(err));
      }
    }

    state.status = 'resolved';
    state.recommendedActions = [];
    state.remediationAction = 'none';
    state.cooldownUntil = null;
    this.#persist(state, new Date().toISOString());
    this.#appendTimeline(state, 'resolved', {
      reason,
      rollbackFailures,
    });

    this.#active.delete(state.type);
    if (this.#active.size === 0) {
      this.#safeMode = false;
    }

    void logThought(`[IncidentManager] ${state.type}: resolved. ${reason}`);
  }

  #escalate(state: ActiveIncidentState, reason: string): void {
    state.status = 'escalated';
    state.recommendedActions = this.#recommendedActions(state.type);
    this.#persist(state);
    this.#appendTimeline(state, 'escalated', {
      reason,
      recommendations: state.recommendedActions,
      remediationAttempts: state.remediationAttempts,
    });

    void logThought(
      `[IncidentManager] ${state.type}: escalated after ${state.remediationAttempts} attempt(s). ${reason}`,
    );
  }

  #recommendedActions(type: IncidentType): string[] {
    switch (type) {
      case 'queue_backpressure':
        return [
          'Inspect outbound adapter availability and delivery queue growth sources.',
          'Replay dead-letter entries selectively after connectivity stabilizes.',
        ];
      case 'callback_failure_storm':
        return [
          'Validate callback signature configuration and upstream webhook retries.',
          'Pause new callback-producing workloads until reject rate stabilizes.',
        ];
      case 'context_budget_degradation':
        return [
          'Inspect conversation scope growth and prune long-running sessions.',
          'Tune context budget env vars for hot/warm/archive retention tiers.',
        ];
      case 'model_routing_instability':
        return [
          'Verify upstream model provider credentials and quotas.',
          'Pin a stable provider temporarily and inspect provider health telemetry.',
        ];
      default:
        return ['Inspect runtime logs and choose a manual remediation path.'];
    }
  }

  #persist(state: ActiveIncidentState, resolvedAt: string | null = null): void {
    upsertIncidentRecord({
      id: state.id,
      incidentType: state.type,
      severity: state.severity,
      status: state.status,
      summary: state.summary,
      evidenceJson: JSON.stringify(state.evidence),
      remediationAction: state.remediationAction,
      remediationAttempts: state.remediationAttempts,
      cooldownUntil: state.cooldownUntil ? new Date(state.cooldownUntil).toISOString() : null,
      escalated: state.status === 'escalated',
      recommendedActionsJson: JSON.stringify(state.recommendedActions),
      resolvedAt,
    });
  }

  #appendTimeline(state: ActiveIncidentState, eventType: string, detail: Record<string, unknown>): void {
    appendIncidentTimelineEntry({
      id: randomUUID(),
      incidentId: state.id,
      incidentType: state.type,
      eventType,
      detailJson: JSON.stringify(detail),
    });
  }

  #toIncidentRecord(row: IncidentRecordRow): IncidentRecord {
    return {
      id: row.id,
      incidentType: row.incident_type,
      severity: row.severity,
      status: row.status,
      summary: row.summary,
      evidence: this.#parseJson<IncidentEvidence[]>(row.evidence_json, []),
      remediationAction: row.remediation_action,
      remediationAttempts: row.remediation_attempts,
      cooldownUntil: row.cooldown_until,
      escalated: row.escalated === 1,
      recommendedActions: this.#parseJson<string[]>(row.recommended_actions_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at,
    };
  }

  #toTimelineEntry(row: IncidentTimelineRow): IncidentTimelineEntry {
    return {
      id: row.id,
      incidentId: row.incident_id,
      incidentType: row.incident_type,
      eventType: row.event_type,
      detail: this.#parseJson<Record<string, unknown>>(row.detail_json, {}),
      createdAt: row.created_at,
    };
  }

  #parseJson<T>(value: string, fallback: T): T {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = getConfigValue(name);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}
