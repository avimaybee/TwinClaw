/** Standardized API response envelope. */
export interface ApiEnvelope<T = unknown> {
    ok: boolean;
    data?: T;
    error?: string;
    timestamp: string;
}

// ── Health ──────────────────────────────────────────────────────────────────

export interface HealthData {
    status: 'ok' | 'degraded';
    uptime: number;
    heartbeat: { running: boolean };
    skills: { builtin: number; mcp: number; total: number };
    mcpServers: Array<{
        id: string;
        name: string;
        state: string;
        toolCount: number;
    }>;
}

// ── Browser ─────────────────────────────────────────────────────────────────

export interface BrowserSnapshotRequest {
    url?: string;
    fullPage?: boolean;
}

export interface BrowserSnapshotData {
    screenshotPath: string;
    viewport: { width: number; height: number };
    accessibilityTree: string;
}

export interface BrowserClickRequest {
    selector?: string;
    x?: number;
    y?: number;
}

export interface BrowserClickData {
    clicked: true;
    method: 'selector' | 'coordinates';
    detail: string;
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
}
