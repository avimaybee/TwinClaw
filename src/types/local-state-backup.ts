import type { JobSnapshot } from './scheduler.js';

export type LocalStateBackupTrigger = 'manual' | 'scheduled';

export type LocalStateBackupScope =
  | 'identity'
  | 'memory'
  | 'runtime-db'
  | 'config'
  | 'policy-profiles'
  | 'mcp-config'
  | 'skill-packages';

export type LocalStateEntryKind = 'file' | 'directory';

export type LocalStateRestoreStatus = 'dry-run' | 'restored' | 'failed';

export interface LocalStateSnapshotEntry {
  id: string;
  scope: LocalStateBackupScope;
  relativePath: string;
  kind: LocalStateEntryKind;
  exists: boolean;
  checksum: string | null;
  fileCount: number;
  byteSize: number;
}

export interface LocalStateSnapshotManifest {
  manifestVersion: 1;
  snapshotId: string;
  trigger: LocalStateBackupTrigger;
  createdAt: string;
  retentionLimit: number;
  entries: LocalStateSnapshotEntry[];
}

export interface LocalStateSnapshotRecord {
  snapshotId: string;
  trigger: LocalStateBackupTrigger;
  status: 'ready' | 'failed' | 'pruned';
  scopes: LocalStateBackupScope[];
  entryCount: number;
  manifestPath: string;
  checksum: string | null;
  detail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalStateValidationIssue {
  entryId: string;
  message: string;
}

export interface LocalStateValidationResult {
  snapshotId: string;
  scopes: LocalStateBackupScope[];
  entries: LocalStateSnapshotEntry[];
  issues: LocalStateValidationIssue[];
}

export interface LocalStateRestoreOptions {
  snapshotId?: string;
  dryRun?: boolean;
  scopes?: LocalStateBackupScope[];
}

export interface LocalStateRestoreResult {
  status: LocalStateRestoreStatus;
  snapshotId: string;
  dryRun: boolean;
  scopes: LocalStateBackupScope[];
  restoredPaths: string[];
  skippedPaths: string[];
  validationErrors: string[];
  rollbackApplied: boolean;
  startedAt: string;
  completedAt: string;
}

export interface LocalStateRestoreEvent {
  id: string;
  snapshotId: string | null;
  outcome: LocalStateRestoreStatus;
  dryRun: boolean;
  scopes: LocalStateBackupScope[];
  restoredPaths: string[];
  skippedPaths: string[];
  validationErrors: string[];
  rollbackApplied: boolean;
  detail: string | null;
  createdAt: string;
}

export interface LocalStateBackupDiagnostics {
  status: 'ok' | 'degraded';
  scheduler: {
    enabled: boolean;
    jobId: string;
    job: JobSnapshot | null;
    cronExpression: string;
  };
  lastSnapshotAt: string | null;
  lastRestoreAt: string | null;
  validationFailureCount: number;
  snapshots: LocalStateSnapshotRecord[];
  restoreEvents: LocalStateRestoreEvent[];
  recommendations: string[];
}

export interface LocalStateSnapshotRequest {
  retentionLimit?: number;
}

export interface LocalStateRestoreRequest {
  snapshotId?: string;
  dryRun?: boolean;
  scopes?: LocalStateBackupScope[];
}

