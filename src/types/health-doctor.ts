// ── Health Doctor Types ──────────────────────────────────────────────────────

/**
 * Severity of an individual health check result.
 *
 * - `ok`       — Check passed; no action needed.
 * - `warning`  — Degraded state; service still functional but attention required.
 * - `critical` — Hard failure; service is non-functional or startup should be blocked.
 */
export type HealthCheckSeverity = 'ok' | 'warning' | 'critical';

/**
 * Aggregated readiness level derived from all check results.
 *
 * - `ready`    — All checks passed.
 * - `degraded` — One or more warnings; runtime continues but with reduced reliability.
 * - `not_ready`— One or more critical failures; runtime is blocked or severely impaired.
 */
export type ReadinessLevel = 'ready' | 'degraded' | 'not_ready';

/** A single named health check result. */
export interface HealthCheckResult {
    /** Stable machine-readable identifier (e.g. `db_availability`). */
    id: string;
    /** Human-readable display name. */
    name: string;
    /** Outcome of the check. */
    severity: HealthCheckSeverity;
    /** Description of what was checked and what was observed. */
    message: string;
    /** Actionable remediation steps if severity is not `ok`. */
    remediation?: string;
}

/** Aggregated readiness summary across all checks. */
export interface ReadinessSummary {
    level: ReadinessLevel;
    totalChecks: number;
    passed: number;
    warnings: number;
    critical: number;
    evaluatedAt: string;
}

/** Full doctor report returned by the doctor service. */
export interface DoctorReport {
    readiness: ReadinessSummary;
    checks: HealthCheckResult[];
}
