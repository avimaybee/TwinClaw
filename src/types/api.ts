import type { IncidentRecord, IncidentTimelineEntry } from './incident.js';
import type {
    PersonaStateSnapshot,
    PersonaStateUpdateResult,
} from './persona-state.js';
import type {
    LocalStateBackupDiagnostics,
    LocalStateRestoreRequest,
    LocalStateRestoreResult,
    LocalStateSnapshotManifest,
} from './local-state-backup.js';
import type {
    RuntimeBudgetAction,
    RuntimeBudgetEvent,
    RuntimeBudgetLimits,
    RuntimeBudgetProfile,
    RuntimeBudgetSeverity,
    RuntimeUsageAggregate,
    RuntimeProviderUsageAggregate,
} from './runtime-budget.js';
import type { ModelRoutingFallbackMode, ModelRoutingTelemetrySnapshot } from './model-routing.js';

export interface ApiEnvelope<T = unknown> {
    ok: boolean;
    data?: T;
    error?: string;
    correlationId?: string;
    timestamp: string;
}

// ── Health ──────────────────────────────────────────────────────────────────

export interface HealthData {
    status: 'ok' | 'degraded';
    uptimeSec: number;
    memoryUsageMb: number;
    heartbeat: { running: boolean };
    skills: { builtin: number; mcp: number; total: number };
    skillPackages: {
        installed: number;
        active: number;
        blocked: number;
        warnings: string[];
        violations: Array<{
            packageName: string;
            version: string;
            code: string;
            message: string;
            remediation: string;
        }>;
    };
    secrets?: {
        status: 'ok' | 'degraded';
        missingRequired: string[];
        expired: string[];
        warnings: string[];
        total: number;
        active: number;
        dueForRotation: string[];
    };
    budget?: {
        severity: RuntimeBudgetSeverity;
        profile: RuntimeBudgetProfile;
        pacingDelayMs: number;
        manualProfile: RuntimeBudgetProfile | null;
        daily: RuntimeUsageAggregate;
        session: RuntimeUsageAggregate;
        providers: RuntimeProviderUsageAggregate[];
    };
    routing?: ModelRoutingTelemetrySnapshot;
    backups?: {
        status: 'ok' | 'degraded';
        lastSnapshotAt: string | null;
        lastRestoreAt: string | null;
        validationFailureCount: number;
        recommendationCount: number;
    };
    mcpServers: Array<{
        id: string;
        name: string;
        state: string;
        toolCount: number;
        health?: {
            circuit: string;
            failureCount: number;
            remainingCooldownMs: number;
        };
    }>;
}

// ── Browser ─────────────────────────────────────────────────────────────────

export interface BrowserSnapshotRequest {
    url?: string;
    fullPage?: boolean;
}

export interface BrowserReferenceMapEntry {
    ref: string;
    selector: string;
    role: string;
    name: string;
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

export interface BrowserSnapshotData {
    snapshotId: string;
    screenshotPath: string;
    viewport: { width: number; height: number };
    accessibilityTree: string;
    references: BrowserReferenceMapEntry[];
}

export interface BrowserClickRequest {
    ref?: string;
    snapshotId?: string;
    selector?: string;
    x?: number;
    y?: number;
}

export interface BrowserClickData {
    clicked: true;
    method: 'reference' | 'selector' | 'coordinates';
    detail: string;
    ref?: string;
    snapshotId?: string;
}

// ── Webhook Callback ────────────────────────────────────────────────────────

export interface WebhookCallbackPayload {
    eventType: string;
    taskId: string;
    status: 'completed' | 'failed' | 'progress';
    result?: unknown;
    error?: string;
}

export interface WebhookCallbackData {
    accepted: true;
    eventType: string;
    taskId: string;
    outcome?: 'accepted' | 'duplicate';
}

// ── Incident Self-Healing ────────────────────────────────────────────────────

export interface IncidentCurrentData {
    safeMode: boolean;
    incidents: IncidentRecord[];
}

export interface IncidentHistoryData {
    incidents: IncidentRecord[];
    timeline: IncidentTimelineEntry[];
}

// ── Persona State ─────────────────────────────────────────────────────────────

export type PersonaStateData = PersonaStateSnapshot;

export interface PersonaStateUpdateRequest {
    expectedRevision: string;
    soul: string;
    identity: string;
    user: string;
}

export type PersonaStateUpdateData = PersonaStateUpdateResult;

export interface PersonaStateErrorDiagnostics {
    hints: string[];
    latestRevision?: string;
}

// ── Local State Backup & Recovery ─────────────────────────────────────────────

export interface LocalStateSnapshotRequest {
    retentionLimit?: number;
}

export interface LocalStateSnapshotData {
    snapshot: LocalStateSnapshotManifest;
}

export interface LocalStateRestoreData {
    request: LocalStateRestoreRequest;
    result: LocalStateRestoreResult;
}

export interface LocalStateBackupDiagnosticsData {
    diagnostics: LocalStateBackupDiagnostics;
}

// ── Runtime Budget Governance ────────────────────────────────────────────────

export interface BudgetStateData {
    sessionId: string;
    manualProfile: RuntimeBudgetProfile | null;
    limits: RuntimeBudgetLimits;
    daily: RuntimeUsageAggregate;
    session: RuntimeUsageAggregate;
    providers: RuntimeProviderUsageAggregate[];
    directive: {
        profile: RuntimeBudgetProfile;
        severity: RuntimeBudgetSeverity;
        actions: RuntimeBudgetAction[];
        pacingDelayMs: number;
        blockedModelIds: string[];
        blockedProviders: string[];
        reason: string;
        evaluatedAt: string;
    };
    recentEvents: RuntimeBudgetEvent[];
}

// ── Model Routing Telemetry ───────────────────────────────────────────────────

export type RoutingTelemetryData = ModelRoutingTelemetrySnapshot;

export interface RoutingModeUpdateRequest {
    mode: ModelRoutingFallbackMode;
}

export interface RoutingModeUpdateData {
    message: string;
    snapshot: ModelRoutingTelemetrySnapshot;
}
