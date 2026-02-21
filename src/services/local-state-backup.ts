import { randomUUID, createHash } from 'node:crypto';
import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type {
  LocalStateBackupDiagnostics,
  LocalStateBackupScope,
  LocalStateBackupTrigger,
  LocalStateRestoreEvent,
  LocalStateRestoreOptions,
  LocalStateRestoreResult,
  LocalStateSnapshotEntry,
  LocalStateSnapshotManifest,
  LocalStateSnapshotRecord,
  LocalStateValidationResult,
} from '../types/local-state-backup.js';
import type { JobScheduler } from './job-scheduler.js';
import {
  listLocalStateRestoreEvents,
  listLocalStateSnapshotRecords,
  removeLocalStateSnapshotRecords,
  saveLocalStateRestoreEvent,
  upsertLocalStateSnapshotRecord,
  type LocalStateRestoreEventRow,
  type LocalStateSnapshotRecordRow,
} from './db.js';
import { logThought, scrubSensitiveText } from '../utils/logger.js';
import { getConfigValue } from '../config/config-loader.js';

const BACKUP_JOB_ID = 'local-state-snapshot';
const MANIFEST_VERSION = 1;
const DEFAULT_RETENTION_LIMIT = 7;
const DEFAULT_SNAPSHOT_CRON = '0 */6 * * *';

interface SnapshotTarget {
  id: string;
  scope: LocalStateBackupScope;
  relativePath: string;
  kind: 'file' | 'directory';
}

const SNAPSHOT_TARGETS: SnapshotTarget[] = [
  { id: 'identity-dir', scope: 'identity', relativePath: 'identity', kind: 'directory' },
  { id: 'memory-dir', scope: 'memory', relativePath: 'memory', kind: 'directory' },
  { id: 'runtime-db', scope: 'runtime-db', relativePath: path.join('memory', 'twinclaw.db'), kind: 'file' },
  {
    id: 'policy-profiles',
    scope: 'policy-profiles',
    relativePath: path.join('memory', 'policy-profiles.json'),
    kind: 'file',
  },
  { id: 'mcp-config', scope: 'mcp-config', relativePath: 'mcp-servers.json', kind: 'file' },
  { id: 'skill-catalog', scope: 'skill-packages', relativePath: 'skill-packages.json', kind: 'file' },
  {
    id: 'skill-lock',
    scope: 'skill-packages',
    relativePath: 'skill-packages.lock.json',
    kind: 'file',
  },
];
const SNAPSHOT_TARGETS_BY_ID = new Map(SNAPSHOT_TARGETS.map((target) => [target.id, target]));

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function compactTimestamp(now: () => Date): string {
  return now().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function hashContent(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeScopes(scopes?: LocalStateBackupScope[]): LocalStateBackupScope[] {
  if (!scopes || scopes.length === 0) {
    return [...new Set(SNAPSHOT_TARGETS.map((target) => target.scope))];
  }
  const allowed = new Set<LocalStateBackupScope>(SNAPSHOT_TARGETS.map((target) => target.scope));
  return [...new Set(scopes)].filter((scope) => allowed.has(scope));
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureParentDir(targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
}

async function movePath(sourcePath: string, destinationPath: string, kind: 'file' | 'directory'): Promise<void> {
  await ensureParentDir(destinationPath);
  try {
    await rename(sourcePath, destinationPath);
    return;
  } catch {
    if (kind === 'directory') {
      await cp(sourcePath, destinationPath, { recursive: true });
      await rm(sourcePath, { recursive: true, force: true });
      return;
    }
    await copyFile(sourcePath, destinationPath);
    await rm(sourcePath, { force: true });
  }
}

export interface LocalStateBackupServiceOptions {
  workspaceRoot?: string;
  backupRootDir?: string;
  retentionLimit?: number;
  snapshotCronExpression?: string;
  scheduler?: JobScheduler;
  now?: () => Date;
  beforeRestoreApplyForTest?: (entry: LocalStateSnapshotEntry) => void;
}

export class LocalStateBackupService {
  readonly #workspaceRoot: string;
  readonly #backupRootDir: string;
  readonly #snapshotsDir: string;
  readonly #operationsDir: string;
  readonly #retentionLimit: number;
  readonly #snapshotCronExpression: string;
  readonly #scheduler?: JobScheduler;
  readonly #now: () => Date;
  readonly #beforeRestoreApplyForTest?: (entry: LocalStateSnapshotEntry) => void;

  constructor(options: LocalStateBackupServiceOptions = {}) {
    this.#workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.#backupRootDir =
      options.backupRootDir ??
      path.join(this.#workspaceRoot, '.twinclaw', 'state-backups');
    this.#snapshotsDir = path.join(this.#backupRootDir, 'snapshots');
    this.#operationsDir = path.join(this.#backupRootDir, 'operations');
    this.#retentionLimit = Math.max(1, options.retentionLimit ?? DEFAULT_RETENTION_LIMIT);
    this.#snapshotCronExpression =
      options.snapshotCronExpression ?? getConfigValue('LOCAL_STATE_SNAPSHOT_CRON') ?? DEFAULT_SNAPSHOT_CRON;
    this.#scheduler = options.scheduler;
    this.#now = options.now ?? (() => new Date());
    this.#beforeRestoreApplyForTest = options.beforeRestoreApplyForTest;
  }

  start(): void {
    if (!this.#scheduler || this.#scheduler.getJob(BACKUP_JOB_ID)) {
      return;
    }

    this.#scheduler.register({
      id: BACKUP_JOB_ID,
      cronExpression: this.#snapshotCronExpression,
      description: 'Capture local-state snapshot with retention cleanup',
      handler: async () => {
        try {
          await this.createSnapshot({ trigger: 'scheduled' });
        } catch (error) {
          const message = scrubSensitiveText(error instanceof Error ? error.message : String(error));
          const failedId = `snapshot_failed_${compactTimestamp(this.#now)}`;
          upsertLocalStateSnapshotRecord({
            snapshotId: failedId,
            triggerType: 'scheduled',
            status: 'failed',
            scopes: [],
            entryCount: 0,
            manifestPath: '',
            checksum: null,
            detail: message,
          });
          await logThought(`[LocalStateBackup] Scheduled snapshot failed: ${message}`);
        }
      },
      autoStart: true,
    });
  }

  stop(): void {
    this.#scheduler?.unregister(BACKUP_JOB_ID);
  }

  async createSnapshot(options: {
    trigger?: LocalStateBackupTrigger;
    retentionLimit?: number;
  } = {}): Promise<LocalStateSnapshotManifest> {
    const trigger = options.trigger ?? 'manual';
    const retentionLimit = Math.max(1, options.retentionLimit ?? this.#retentionLimit);
    await this.#ensureDirectories();

    const snapshotId = await this.#createSnapshotId();
    const snapshotDir = this.#snapshotDir(snapshotId);
    const stateRoot = this.#snapshotStateRoot(snapshotId);
    await mkdir(stateRoot, { recursive: true });

    const entries: LocalStateSnapshotEntry[] = [];
    for (const target of SNAPSHOT_TARGETS) {
      const sourcePath = this.#resolveWorkspacePath(target.relativePath);
      const snapshotPath = this.#snapshotStatePath(snapshotId, target.relativePath);
      const exists = await pathExists(sourcePath);

      let checksum: string | null = null;
      let byteSize = 0;
      let fileCount = 0;

      if (exists) {
        await this.#copyPath(sourcePath, snapshotPath, target.kind, true);
        const checksumResult = await this.#calculateChecksum(snapshotPath, target.kind, false);
        checksum = checksumResult.checksum;
        byteSize = checksumResult.byteSize;
        fileCount = checksumResult.fileCount;
      }

      entries.push({
        id: target.id,
        scope: target.scope,
        relativePath: target.relativePath,
        kind: target.kind,
        exists,
        checksum,
        byteSize,
        fileCount,
      });
    }

    const manifest: LocalStateSnapshotManifest = {
      manifestVersion: MANIFEST_VERSION,
      snapshotId,
      trigger,
      createdAt: nowIso(this.#now),
      retentionLimit,
      entries,
    };

    const manifestPath = path.join(snapshotDir, 'manifest.json');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const scopeSet = [...new Set(entries.map((entry) => entry.scope))];
    const manifestChecksum = hashContent(JSON.stringify(manifest));
    upsertLocalStateSnapshotRecord({
      snapshotId,
      triggerType: trigger,
      status: 'ready',
      scopes: scopeSet,
      entryCount: entries.length,
      manifestPath,
      checksum: manifestChecksum,
      detail: null,
      createdAt: manifest.createdAt,
    });

    await this.#pruneSnapshots(retentionLimit);
    await logThought(
      `[LocalStateBackup] Snapshot ${snapshotId} created (${entries.length} tracked state entries, trigger=${trigger}).`,
    );
    return manifest;
  }

  async validateSnapshot(
    snapshotId: string,
    scopes?: LocalStateBackupScope[],
  ): Promise<LocalStateValidationResult> {
    const manifest = await this.#readManifest(snapshotId);
    const selectedScopes = normalizeScopes(scopes);
    const selectedEntries = manifest.entries.filter((entry) => selectedScopes.includes(entry.scope));
    const issues: Array<{ entryId: string; message: string }> = [];

    for (const entry of selectedEntries) {
      const snapshotPath = this.#snapshotStatePath(snapshotId, entry.relativePath);
      const exists = await pathExists(snapshotPath);
      if (!entry.exists) {
        continue;
      }
      if (!exists) {
        issues.push({
          entryId: entry.id,
          message: `Snapshot path is missing for '${entry.relativePath}'.`,
        });
        continue;
      }

      const checksumResult = await this.#calculateChecksum(snapshotPath, entry.kind, false);
      if (checksumResult.checksum !== entry.checksum) {
        issues.push({
          entryId: entry.id,
          message: `Checksum mismatch for '${entry.relativePath}'.`,
        });
      }
      if (checksumResult.fileCount !== entry.fileCount) {
        issues.push({
          entryId: entry.id,
          message: `File count mismatch for '${entry.relativePath}'.`,
        });
      }
      if (checksumResult.byteSize !== entry.byteSize) {
        issues.push({
          entryId: entry.id,
          message: `Byte-size mismatch for '${entry.relativePath}'.`,
        });
      }
    }

    return {
      snapshotId,
      scopes: selectedScopes,
      entries: selectedEntries,
      issues,
    };
  }

  async restoreSnapshot(options: LocalStateRestoreOptions = {}): Promise<LocalStateRestoreResult> {
    const startedAt = nowIso(this.#now);
    const dryRun = options.dryRun ?? false;
    const requestedScopes = normalizeScopes(options.scopes);
    const snapshotId = options.snapshotId ?? (await this.#latestSnapshotId());
    const operationId = randomUUID();

    if (!snapshotId) {
      return this.#persistRestoreResult({
        id: operationId,
        snapshotId: null,
        outcome: 'failed',
        dryRun,
        scopes: requestedScopes,
        restoredPaths: [],
        skippedPaths: [],
        validationErrors: ['No local-state snapshots are available to restore.'],
        rollbackApplied: false,
        detail: 'Restore aborted because no snapshots were found.',
        startedAt,
      });
    }

    let validation: LocalStateValidationResult;
    try {
      validation = await this.validateSnapshot(snapshotId, requestedScopes);
    } catch (error) {
      const message = scrubSensitiveText(error instanceof Error ? error.message : String(error));
      return this.#persistRestoreResult({
        id: operationId,
        snapshotId,
        outcome: 'failed',
        dryRun,
        scopes: requestedScopes,
        restoredPaths: [],
        skippedPaths: [],
        validationErrors: [message],
        rollbackApplied: false,
        detail: 'Restore validation failed before execution.',
        startedAt,
      });
    }

    if (validation.entries.length === 0) {
      return this.#persistRestoreResult({
        id: operationId,
        snapshotId,
        outcome: 'failed',
        dryRun,
        scopes: requestedScopes,
        restoredPaths: [],
        skippedPaths: [],
        validationErrors: ['No snapshot entries matched the selected restore scope.'],
        rollbackApplied: false,
        detail: 'Restore scope selection produced zero entries.',
        startedAt,
      });
    }

    const validationErrors = validation.issues.map((issue) => `${issue.entryId}: ${issue.message}`);
    if (validationErrors.length > 0) {
      return this.#persistRestoreResult({
        id: operationId,
        snapshotId,
        outcome: 'failed',
        dryRun,
        scopes: validation.scopes,
        restoredPaths: [],
        skippedPaths: [],
        validationErrors,
        rollbackApplied: false,
        detail: 'Restore blocked because snapshot integrity validation failed.',
        startedAt,
      });
    }

    if (dryRun) {
      const restoredPaths = validation.entries
        .filter((entry) => entry.exists)
        .map((entry) => entry.relativePath);
      const skippedPaths = validation.entries
        .filter((entry) => !entry.exists)
        .map((entry) => entry.relativePath);
      return this.#persistRestoreResult({
        id: operationId,
        snapshotId,
        outcome: 'dry-run',
        dryRun: true,
        scopes: validation.scopes,
        restoredPaths,
        skippedPaths,
        validationErrors: [],
        rollbackApplied: false,
        detail: 'Dry-run validation completed with no integrity issues.',
        startedAt,
      });
    }

    await this.#ensureDirectories();
    const operationRoot = path.join(this.#operationsDir, `${snapshotId}_${compactTimestamp(this.#now)}_${operationId}`);
    const stagingRoot = path.join(operationRoot, 'staging');
    const rollbackRoot = path.join(operationRoot, 'rollback');
    await mkdir(stagingRoot, { recursive: true });
    await mkdir(rollbackRoot, { recursive: true });

    const restoredPaths: string[] = [];
    const skippedPaths: string[] = [];
    const backedUpEntries = new Map<string, boolean>();
    const appliedEntries: LocalStateSnapshotEntry[] = [];
    let rollbackApplied = false;

    try {
      for (const entry of validation.entries) {
        const targetPath = this.#resolveWorkspacePath(entry.relativePath);
        const targetExists = await pathExists(targetPath);
        const rollbackPath = path.join(rollbackRoot, entry.id);
        backedUpEntries.set(entry.id, targetExists);

        if (targetExists) {
          const targetStat = await stat(targetPath);
          const targetKind = targetStat.isDirectory() ? 'directory' : 'file';
          await this.#copyPath(targetPath, rollbackPath, targetKind, false);
        }

        if (entry.exists) {
          const snapshotPath = this.#snapshotStatePath(snapshotId, entry.relativePath);
          const stagingPath = path.join(stagingRoot, entry.id);
          await this.#copyPath(snapshotPath, stagingPath, entry.kind, false);
        }
      }

      for (const entry of validation.entries) {
        if (this.#beforeRestoreApplyForTest) {
          this.#beforeRestoreApplyForTest(entry);
        }

        const targetPath = this.#resolveWorkspacePath(entry.relativePath);
        await rm(targetPath, { recursive: true, force: true });

        if (entry.exists) {
          const stagingPath = path.join(stagingRoot, entry.id);
          await movePath(stagingPath, targetPath, entry.kind);
          restoredPaths.push(entry.relativePath);
        } else {
          skippedPaths.push(entry.relativePath);
        }
        appliedEntries.push(entry);
      }

      return await this.#persistRestoreResult({
        id: operationId,
        snapshotId,
        outcome: 'restored',
        dryRun: false,
        scopes: validation.scopes,
        restoredPaths,
        skippedPaths,
        validationErrors: [],
        rollbackApplied: false,
        detail: `Restore completed successfully for snapshot '${snapshotId}'.`,
        startedAt,
      });
    } catch (error) {
      rollbackApplied = appliedEntries.length > 0;
      const message = scrubSensitiveText(error instanceof Error ? error.message : String(error));

      if (rollbackApplied) {
        for (const entry of [...appliedEntries].reverse()) {
          const targetPath = this.#resolveWorkspacePath(entry.relativePath);
          const rollbackPath = path.join(rollbackRoot, entry.id);
          await rm(targetPath, { recursive: true, force: true });

          if (backedUpEntries.get(entry.id) && (await pathExists(rollbackPath))) {
            const rollbackKind = (await stat(rollbackPath)).isDirectory() ? 'directory' : 'file';
            await movePath(rollbackPath, targetPath, rollbackKind);
          }
        }
      }

      return await this.#persistRestoreResult({
        id: operationId,
        snapshotId,
        outcome: 'failed',
        dryRun: false,
        scopes: validation.scopes,
        restoredPaths,
        skippedPaths,
        validationErrors: [message],
        rollbackApplied,
        detail: `Restore failed for snapshot '${snapshotId}'.`,
        startedAt,
      });
    } finally {
      await rm(operationRoot, { recursive: true, force: true });
    }
  }

  async getDiagnostics(limit = 20): Promise<LocalStateBackupDiagnostics> {
    const snapshots = listLocalStateSnapshotRecords(limit).map((row) => this.#toSnapshotRecord(row));
    const restoreEvents = listLocalStateRestoreEvents(limit).map((row) => this.#toRestoreEvent(row));
    const validationFailureCount = restoreEvents.filter((event) => event.outcome === 'failed').length;
    const lastSnapshotAt = snapshots.find((snapshot) => snapshot.status === 'ready')?.createdAt ?? null;
    const lastRestoreAt = restoreEvents[0]?.createdAt ?? null;
    const schedulerJob = this.#scheduler?.getJob(BACKUP_JOB_ID) ?? null;

    const recommendations: string[] = [];
    if (snapshots.length === 0) {
      recommendations.push('Create a manual snapshot to establish a recovery baseline.');
    }
    if (validationFailureCount > 0) {
      recommendations.push('Inspect recent restore validation errors before running another restore.');
    }
    if (schedulerJob?.lastError) {
      recommendations.push('Resolve scheduler job errors to restore automated snapshot health.');
    }
    if (recommendations.length === 0) {
      recommendations.push('Backup and restore system is healthy.');
    }

    return {
      status:
        snapshots.length === 0 || validationFailureCount > 0 || Boolean(schedulerJob?.lastError)
          ? 'degraded'
          : 'ok',
      scheduler: {
        enabled: Boolean(this.#scheduler),
        jobId: BACKUP_JOB_ID,
        job: schedulerJob,
        cronExpression: this.#snapshotCronExpression,
      },
      lastSnapshotAt,
      lastRestoreAt,
      validationFailureCount,
      snapshots,
      restoreEvents,
      recommendations,
    };
  }

  async #persistRestoreResult(input: {
    id: string;
    snapshotId: string | null;
    outcome: 'dry-run' | 'restored' | 'failed';
    dryRun: boolean;
    scopes: LocalStateBackupScope[];
    restoredPaths: string[];
    skippedPaths: string[];
    validationErrors: string[];
    rollbackApplied: boolean;
    detail: string | null;
    startedAt: string;
  }): Promise<LocalStateRestoreResult> {
    const completedAt = nowIso(this.#now);
    saveLocalStateRestoreEvent({
      id: input.id,
      snapshotId: input.snapshotId,
      outcome: input.outcome,
      dryRun: input.dryRun,
      scopes: input.scopes,
      restoredPaths: input.restoredPaths,
      skippedPaths: input.skippedPaths,
      validationErrors: input.validationErrors,
      rollbackApplied: input.rollbackApplied,
      detail: input.detail,
      createdAt: completedAt,
    });

    const message = input.detail
      ? `${input.detail} restored=${input.restoredPaths.length} skipped=${input.skippedPaths.length}`
      : `Restore outcome=${input.outcome}.`;
    await logThought(`[LocalStateBackup] ${message}`);

    return {
      status: input.outcome,
      snapshotId: input.snapshotId ?? 'unresolved',
      dryRun: input.dryRun,
      scopes: input.scopes,
      restoredPaths: input.restoredPaths,
      skippedPaths: input.skippedPaths,
      validationErrors: input.validationErrors,
      rollbackApplied: input.rollbackApplied,
      startedAt: input.startedAt,
      completedAt,
    };
  }

  #toSnapshotRecord(row: LocalStateSnapshotRecordRow): LocalStateSnapshotRecord {
    return {
      snapshotId: row.snapshot_id,
      trigger: row.trigger_type,
      status: row.status,
      scopes: safeParseJson<LocalStateBackupScope[]>(row.scopes_json, []),
      entryCount: row.entry_count,
      manifestPath: row.manifest_path,
      checksum: row.checksum,
      detail: row.detail,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  #toRestoreEvent(row: LocalStateRestoreEventRow): LocalStateRestoreEvent {
    return {
      id: row.id,
      snapshotId: row.snapshot_id,
      outcome: row.outcome,
      dryRun: row.dry_run === 1,
      scopes: safeParseJson<LocalStateBackupScope[]>(row.scopes_json, []),
      restoredPaths: safeParseJson<string[]>(row.restored_paths_json, []),
      skippedPaths: safeParseJson<string[]>(row.skipped_paths_json, []),
      validationErrors: safeParseJson<string[]>(row.validation_errors_json, []),
      rollbackApplied: row.rollback_applied === 1,
      detail: row.detail,
      createdAt: row.created_at,
    };
  }

  async #latestSnapshotId(): Promise<string | undefined> {
    const records = listLocalStateSnapshotRecords(1).filter((row) => row.status === 'ready');
    const fromRecords = records[0]?.snapshot_id;
    if (fromRecords) {
      return fromRecords;
    }

    if (!(await pathExists(this.#snapshotsDir))) {
      return undefined;
    }
    const entries = await readdir(this.#snapshotsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse()[0];
  }

  async #readManifest(snapshotId: string): Promise<LocalStateSnapshotManifest> {
    const manifestPath = path.join(this.#snapshotDir(snapshotId), 'manifest.json');
    const raw = await readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as LocalStateSnapshotManifest;

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      parsed.manifestVersion !== MANIFEST_VERSION ||
      !Array.isArray(parsed.entries)
    ) {
      throw new Error(`Snapshot '${snapshotId}' has an invalid manifest.`);
    }
    for (const entry of parsed.entries) {
      if (
        !entry ||
        typeof entry.id !== 'string' ||
        typeof entry.scope !== 'string' ||
        typeof entry.relativePath !== 'string' ||
        typeof entry.kind !== 'string'
      ) {
        throw new Error(`Snapshot '${snapshotId}' contains invalid entry metadata.`);
      }
      const target = SNAPSHOT_TARGETS_BY_ID.get(entry.id);
      if (!target) {
        throw new Error(`Snapshot '${snapshotId}' contains unsupported entry '${entry.id}'.`);
      }
      if (
        entry.scope !== target.scope ||
        entry.relativePath !== target.relativePath ||
        entry.kind !== target.kind
      ) {
        throw new Error(`Snapshot '${snapshotId}' has mismatched metadata for entry '${entry.id}'.`);
      }
    }
    return parsed;
  }

  async #pruneSnapshots(retentionLimit: number): Promise<void> {
    if (!(await pathExists(this.#snapshotsDir))) {
      return;
    }

    const entries = await readdir(this.#snapshotsDir, { withFileTypes: true });
    const snapshotIds = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();

    const stale = snapshotIds.slice(retentionLimit);
    for (const snapshotId of stale) {
      await rm(this.#snapshotDir(snapshotId), { recursive: true, force: true });
    }
    removeLocalStateSnapshotRecords(stale);
  }

  async #createSnapshotId(): Promise<string> {
    const base = `snapshot_${compactTimestamp(this.#now)}`;
    let candidate = base;
    let suffix = 1;

    while (await pathExists(this.#snapshotDir(candidate))) {
      candidate = `${base}_${String(suffix).padStart(2, '0')}`;
      suffix += 1;
    }
    return candidate;
  }

  async #copyPath(
    sourcePath: string,
    destinationPath: string,
    kind: 'file' | 'directory',
    applySourceFilter: boolean,
  ): Promise<void> {
    await ensureParentDir(destinationPath);
    if (kind === 'directory') {
      await cp(sourcePath, destinationPath, {
        recursive: true,
        filter: (source) => (applySourceFilter ? this.#shouldIncludeSource(source) : true),
      });
      return;
    }
    await copyFile(sourcePath, destinationPath);
  }

  async #calculateChecksum(
    targetPath: string,
    kind: 'file' | 'directory',
    applySourceFilter: boolean,
  ): Promise<{ checksum: string; byteSize: number; fileCount: number }> {
    if (kind === 'file') {
      const buffer = await readFile(targetPath);
      return {
        checksum: createHash('sha256').update(buffer).digest('hex'),
        byteSize: buffer.byteLength,
        fileCount: 1,
      };
    }

    const files = await this.#listDirectoryFiles(targetPath, targetPath, applySourceFilter);
    let totalBytes = 0;
    const digest = createHash('sha256');
    for (const relativeFile of files) {
      const absoluteFile = path.join(targetPath, relativeFile);
      const buffer = await readFile(absoluteFile);
      totalBytes += buffer.byteLength;
      const fileHash = createHash('sha256').update(buffer).digest('hex');
      digest.update(`${relativeFile}:${fileHash}:${buffer.byteLength}\n`);
    }

    return {
      checksum: digest.digest('hex'),
      byteSize: totalBytes,
      fileCount: files.length,
    };
  }

  async #listDirectoryFiles(
    directoryPath: string,
    rootPath: string,
    applySourceFilter: boolean,
  ): Promise<string[]> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);
      if (applySourceFilter && !this.#shouldIncludeSource(absolutePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        const nested = await this.#listDirectoryFiles(absolutePath, rootPath, applySourceFilter);
        files.push(...nested);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }
      files.push(path.relative(rootPath, absolutePath).split(path.sep).join('/'));
    }

    return files.sort((left, right) => left.localeCompare(right));
  }

  #shouldIncludeSource(sourcePath: string): boolean {
    const absolute = path.resolve(sourcePath);
    if (absolute === this.#backupRootDir) {
      return false;
    }
    return !absolute.startsWith(`${this.#backupRootDir}${path.sep}`);
  }

  async #ensureDirectories(): Promise<void> {
    await mkdir(this.#snapshotsDir, { recursive: true });
    await mkdir(this.#operationsDir, { recursive: true });
  }

  #snapshotDir(snapshotId: string): string {
    return path.join(this.#snapshotsDir, snapshotId);
  }

  #snapshotStateRoot(snapshotId: string): string {
    return path.join(this.#snapshotDir(snapshotId), 'state');
  }

  #snapshotStatePath(snapshotId: string, relativePath: string): string {
    return path.join(this.#snapshotStateRoot(snapshotId), relativePath);
  }

  #resolveWorkspacePath(relativePath: string): string {
    return path.join(this.#workspaceRoot, relativePath);
  }
}

export { BACKUP_JOB_ID };

