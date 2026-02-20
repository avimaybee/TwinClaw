export type DoctorCheckKind = 'binary' | 'env-var' | 'filesystem' | 'service-endpoint';

export type DoctorSeverity = 'critical' | 'warning' | 'info';

export interface DoctorCheck {
  kind: DoctorCheckKind;
  name: string;
  description: string;
  severity: DoctorSeverity;
  remediation: string;
}

export interface DoctorCheckResult {
  check: DoctorCheck;
  passed: boolean;
  /** Masked or descriptive actual value when relevant. */
  actual?: string;
  message: string;
}

export type DoctorStatus = 'ok' | 'degraded' | 'critical';

export interface DoctorReport {
  status: DoctorStatus;
  results: DoctorCheckResult[];
  checkedAt: string;
  passed: number;
  failed: number;
}
