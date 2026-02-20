// ─── MVP Gate Criterion IDs ──────────────────────────────────────────────────

/**
 * Hard-gate IDs block the "go" verdict if they fail.
 * Advisory IDs produce warnings only.
 */
export type MvpHardGateId =
  | 'build'
  | 'tests'
  | 'api-health'
  | 'interface-readiness'
  | 'npm-commands'
  | 'env-config';

export type MvpAdvisoryId = 'dist-artifact' | 'test-coverage' | 'doctor-readiness';

export type MvpCriterionId = MvpHardGateId | MvpAdvisoryId;

export type MvpCriterionClass = 'hard-gate' | 'advisory';

export type MvpCheckStatus = 'passed' | 'failed' | 'skipped';

export type TriageSeverity = 'blocker' | 'advisory';

export type MvpGateVerdict = 'go' | 'no-go' | 'advisory-only';

// ─── Per-Check Result ────────────────────────────────────────────────────────

export interface MvpCheckResult {
  id: MvpCriterionId;
  class: MvpCriterionClass;
  status: MvpCheckStatus;
  detail: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  command?: string;
  artifacts?: string[];
}

// ─── Smoke Scenarios ─────────────────────────────────────────────────────────

/**
 * A smoke scenario is a deterministic, side-effect-free static check of a
 * critical runtime asset or configuration file.
 */
export interface MvpSmokeScenario {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

// ─── Failure Triage ──────────────────────────────────────────────────────────

/**
 * Maps a failing check to its owning track/agent and a concrete next-action.
 */
export interface TriageEntry {
  checkId: MvpCriterionId;
  severity: TriageSeverity;
  ownerTrack: string;
  detail: string;
  nextAction: string;
}

// ─── Gate Report ─────────────────────────────────────────────────────────────

export interface MvpGateReport {
  reportVersion: 1;
  reportId: string;
  generatedAt: string;
  verdict: MvpGateVerdict;
  hardGatePassed: boolean;
  checks: MvpCheckResult[];
  failedHardGates: MvpCheckResult[];
  advisoryFailures: MvpCheckResult[];
  smokeScenarios: MvpSmokeScenario[];
  triage: TriageEntry[];
  summary: string;
  reportPath: string;
  markdownPath: string;
}

// ─── Service Options ─────────────────────────────────────────────────────────

export interface MvpGateOptions {
  /**
   * URL of the health endpoint. If provided, the `api-health` hard gate is
   * activated; if omitted the check is skipped.
   */
  healthUrl?: string;
}
