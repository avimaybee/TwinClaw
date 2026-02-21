export type ReleaseCheckId =
  | 'build'
  | 'tests'
  | 'api-health'
  | 'interface-readiness';

export type ReleaseCheckStatus = 'passed' | 'failed';

export interface ReleaseCheckResult {
  id: ReleaseCheckId;
  status: ReleaseCheckStatus;
  detail: string;
  command?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface PreflightResult {
  passed: boolean;
  checks: ReleaseCheckResult[];
  failedChecks: ReleaseCheckResult[];
}

export interface SnapshotAssetRecord {
  key: string;
  relativePath: string;
  kind: 'file' | 'directory';
  exists: boolean;
  sourcePath: string;
  snapshotPath: string;
}

export interface RuntimeSnapshotMetadata {
  snapshotId: string;
  releaseId: string;
  createdAt: string;
  retentionLimit: number;
  assets: SnapshotAssetRecord[];
  metadataPath: string;
}

export interface ArtifactPointer {
  id: string;
  path: string;
  exists: boolean;
}

export type ReleaseManifestStatus = 'ready' | 'blocked' | 'rolled_back';

export interface ReleaseManifest {
  manifestVersion: 1;
  releaseId: string;
  generatedAt: string;
  appVersion: string;
  gitCommit: string | null;
  status: ReleaseManifestStatus;
  preflight: PreflightResult;
  snapshot?: {
    snapshotId: string;
    metadataPath: string;
  };
  artifacts: ArtifactPointer[];
  diagnostics: string[];
  manifestPath: string;
}

export interface CommandExecutionResult {
  ok: boolean;
  exitCode: number;
  output: string;
  durationMs: number;
}

export type CommandRunner = (command: string, cwd: string) => Promise<CommandExecutionResult>;

export interface HealthProbeResult {
  ok: boolean;
  detail: string;
  statusCode?: number;
  payloadStatus?: string;
}

export type HealthProbe = (url: string) => Promise<HealthProbeResult>;

export type RollbackStatus = 'restored' | 'noop' | 'failed';

export interface RollbackResult {
  status: RollbackStatus;
  snapshotId: string;
  startedAt: string;
  completedAt: string;
  restoredAssets: string[];
  skippedAssets: string[];
  healthCheck: ReleaseCheckResult;
  diagnostics: string[];
}

export type DrillStatus = 'passed' | 'failed';

export interface DrillResult {
  status: DrillStatus;
  drillId: string;
  startedAt: string;
  completedAt: string;
  simulatedFailure: boolean;
  snapshotRestored: boolean;
  preflightResult: PreflightResult | null;
  rollbackResult: RollbackResult | null;
  integrityCheck: {
    passed: boolean;
    issues: string[];
  };
  diagnostics: string[];
}
