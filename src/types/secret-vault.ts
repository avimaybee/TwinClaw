export type SecretScope = 'api' | 'model' | 'messaging' | 'runtime' | 'storage' | 'integration';

export type SecretSource = 'env' | 'vault' | 'runtime';

export type SecretLifecycleStatus = 'active' | 'revoked' | 'expired';

export interface SecretMetadata {
  name: string;
  scope: SecretScope;
  source: SecretSource;
  required: boolean;
  rotationWindowHours: number;
  warningWindowHours: number;
  lastRotatedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: SecretLifecycleStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SecretSetInput {
  name: string;
  value: string;
  scope?: SecretScope;
  source?: SecretSource;
  required?: boolean;
  rotationWindowHours?: number;
  warningWindowHours?: number;
  expiresAt?: string | null;
}

export interface SecretRotateInput {
  name: string;
  nextValue: string;
  reason?: string;
  rotationWindowHours?: number;
  warningWindowHours?: number;
  expiresAt?: string | null;
}

export interface SecretRevokeInput {
  name: string;
  reason?: string;
}

export interface SecretHealthReport {
  missingRequired: string[];
  expired: string[];
  warnings: string[];
  hasIssues: boolean;
}

export interface SecretDiagnostics {
  health: SecretHealthReport;
  total: number;
  active: number;
  revoked: number;
  expired: number;
  dueForRotation: string[];
}
