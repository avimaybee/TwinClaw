// Match the structure from TwinClaw's src/types/api.ts
export interface ApiEnvelope<T = unknown> {
    ok: boolean;
    data?: T;
    error?: string;
    timestamp: string;
}

export interface SystemHealth {
    status: 'ok' | 'degraded' | 'offline';
    uptimeSec: number;
    memoryUsageMb: number;
    heartbeat: { running: boolean };
    skills: {
        builtin: number;
        mcp: number;
        total: number;
    };
    mcpServers: { id: string; name: string; state: string; toolCount: number }[];
    routing?: ModelRoutingTelemetry;
}

export type ModelRoutingFallbackMode = 'intelligent_pacing' | 'aggressive_fallback';

export interface ModelRoutingTelemetry {
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
    activeCooldowns: Array<{
        modelId: string;
        modelName: string;
        provider: string;
        reason: string;
        remainingMs: number;
        until: string;
    }>;
    usage: Array<{
        modelId: string;
        modelName: string;
        provider: string;
        attempts: number;
        successes: number;
        failures: number;
        rateLimits: number;
        lastUsedAt: string | null;
        lastError: string | null;
    }>;
    recentEvents: Array<{
        id: string;
        type: string;
        modelId: string | null;
        modelName: string | null;
        provider: string | null;
        fallbackMode: ModelRoutingFallbackMode;
        detail: string;
        createdAt: string;
    }>;
    operatorGuidance: string[];
}

export interface DeliveryMetrics {
    totalSent: number;
    totalFailed: number;
    totalDeadLetters: number;
    recentRecords: unknown[];
}

export interface ReliabilityData {
    queue: DeliveryMetrics | null;
    callbacks: {
        totalAccepted: number;
        totalDuplicate: number;
        totalRejected: number;
    };
}

export interface LogEntry {
    timestamp: string;
    level: string;
    message: string;
}

export type IncidentSeverity = 'warning' | 'critical';
export type IncidentStatus = 'active' | 'remediating' | 'escalated' | 'resolved';

export interface IncidentEvidence {
    signal: string;
    observedValue: number;
    threshold: number;
    detail?: string;
    metadata?: Record<string, unknown>;
}

export interface IncidentRecord {
    id: string;
    incidentType: string;
    severity: IncidentSeverity;
    status: IncidentStatus;
    summary: string;
    evidence: IncidentEvidence[];
    remediationAction: string;
    remediationAttempts: number;
    cooldownUntil: string | null;
    escalated: boolean;
    recommendedActions: string[];
    createdAt: string;
    updatedAt: string;
    resolvedAt: string | null;
}

export interface IncidentTimelineEntry {
    id: string;
    incidentId: string;
    incidentType: string;
    eventType: string;
    detail: Record<string, unknown>;
    createdAt: string;
}

export interface IncidentCurrentData {
    safeMode: boolean;
    incidents: IncidentRecord[];
}

export interface IncidentHistoryData {
    incidents: IncidentRecord[];
    timeline: IncidentTimelineEntry[];
}

export interface PersonaStateData {
    revision: string;
    updatedAt: string;
    soul: string;
    identity: string;
    user: string;
}

export interface PersonaStateUpdateRequest {
    expectedRevision: string;
    soul: string;
    identity: string;
    user: string;
}

export interface PersonaStateUpdateDiagnostics {
    outcome: 'updated' | 'noop';
    changedDocuments: Array<'soul' | 'identity' | 'user'>;
    warnings: string[];
}

export interface PersonaStateUpdateData {
    state: PersonaStateData;
    diagnostics: PersonaStateUpdateDiagnostics;
}

export interface PersonaStateErrorDiagnostics {
    hints: string[];
    latestRevision?: string;
}

export class ApiRequestError extends Error {
    readonly status: number;
    readonly diagnostics?: unknown;

    constructor(message: string, status: number, diagnostics?: unknown) {
        super(message);
        this.name = 'ApiRequestError';
        this.status = status;
        this.diagnostics = diagnostics;
    }
}

const API_BASE_URL = 'http://localhost:3100';

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
    try {
        const headers = new Headers(init?.headers ?? {});
        headers.set('Accept', 'application/json');
        if (init?.body && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }

        const response = await fetch(`${API_BASE_URL}${path}`, {
            method: init?.method ?? 'GET',
            headers,
            body: init?.body,
        });

        // Always parse JSON if possible to catch envelope errors
        let body: ApiEnvelope<T>;
        try {
            body = await response.json();
        } catch {
            throw new Error(`Failed to parse response from ${path}`);
        }

        if (!response.ok || !body.ok) {
            throw new ApiRequestError(
                body.error ?? `HTTP ${response.status} from ${path}`,
                response.status,
                body.data,
            );
        }

        return body.data as T;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
    }
}


export const TwinClawApi = {
    getHealth: () => fetchApi<SystemHealth>('/health'),
    getRoutingTelemetry: () => fetchApi<ModelRoutingTelemetry>('/routing/telemetry'),
    setRoutingMode: (mode: ModelRoutingFallbackMode, signature = 'local-gui-override') =>
        fetchApi<{ message: string; snapshot: ModelRoutingTelemetry }>('/routing/mode', {
            method: 'POST',
            headers: { 'x-signature': signature },
            body: JSON.stringify({ mode }),
        }),
    getReliability: () => fetchApi<ReliabilityData>('/reliability'),
    getLogs: () => fetchApi<LogEntry[]>('/logs'),
    getIncidentsCurrent: () => fetchApi<IncidentCurrentData>('/incidents/current'),
    getIncidentsHistory: () => fetchApi<IncidentHistoryData>('/incidents/history?limit=100'),
    getPersonaState: () => fetchApi<PersonaStateData>('/persona/state'),
    updatePersonaState: (payload: PersonaStateUpdateRequest) =>
        fetchApi<PersonaStateUpdateData>('/persona/state', {
            method: 'PUT',
            body: JSON.stringify(payload),
        }),
    haltSystem: (signature: string) => fetch(`${API_BASE_URL}/system/halt`, {
        method: 'POST',
        headers: { 'x-signature': signature }
    }).then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
    }),
};
