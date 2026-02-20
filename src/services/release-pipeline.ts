import { exec } from 'node:child_process';
import {
  appendFile,
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { logThought } from '../utils/logger.js';
import type {
  ArtifactPointer,
  CommandExecutionResult,
  CommandRunner,
  HealthProbe,
  HealthProbeResult,
  PreflightResult,
  ReleaseCheckId,
  ReleaseCheckResult,
  ReleaseManifest,
  RollbackResult,
  RuntimeSnapshotMetadata,
  SnapshotAssetRecord,
} from '../types/release.js';

const execAsync = promisify(exec);
const DEFAULT_RETENTION_LIMIT = 5;
const DEFAULT_HEALTH_URL = 'http://127.0.0.1:3100/health';

type RollbackState = {
  snapshotId: string;
  status: 'in_progress' | 'success' | 'failed';
  updatedAt: string;
  detail: string;
};

type CriticalAsset = {
  key: string;
  relativePath: string;
  kind: 'file' | 'directory';
};

const CRITICAL_ASSETS: CriticalAsset[] = [
  { key: 'runtime-db', relativePath: path.join('memory', 'twinclaw.db'), kind: 'file' },
  { key: 'identity', relativePath: 'identity', kind: 'directory' },
  { key: 'mcp-config', relativePath: 'mcp-servers.json', kind: 'file' },
  { key: 'package-config', relativePath: 'package.json', kind: 'file' },
];

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function compactTimestamp(now: () => Date): string {
  return now().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function summarizeOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return 'No command output captured.';
  }
  const lines = trimmed.split('\n').slice(-5);
  return lines.join('\n');
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isExecError(
  error: unknown,
): error is Error & { code?: number | null; stdout?: string; stderr?: string } {
  return error instanceof Error;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function defaultCommandRunner(command: string, cwd: string): Promise<CommandExecutionResult> {
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = [stdout, stderr].filter(Boolean).join('\n').trim();
    return {
      ok: true,
      exitCode: 0,
      output,
      durationMs: Date.now() - startedAt,
    };
  } catch (error: unknown) {
    if (!isExecError(error)) {
      throw error;
    }
    const output = [error.stdout, error.stderr, error.message]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join('\n')
      .trim();
    return {
      ok: false,
      exitCode: typeof error.code === 'number' ? error.code : 1,
      output,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function defaultHealthProbe(url: string): Promise<HealthProbeResult> {
  let responseStatus: number | undefined;
  let payloadStatus: string | undefined;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(5_000),
    });
    responseStatus = response.status;
    const raw = await response.text();
    if (raw.trim()) {
      const parsed = JSON.parse(raw) as unknown;
      if (isObjectRecord(parsed) && isObjectRecord(parsed.data) && typeof parsed.data.status === 'string') {
        payloadStatus = parsed.data.status;
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        detail: `Health endpoint returned HTTP ${response.status}.`,
        statusCode: responseStatus,
        payloadStatus,
      };
    }

    if (payloadStatus !== 'ok' && payloadStatus !== 'degraded') {
      return {
        ok: false,
        detail: 'Health endpoint responded without a valid system status.',
        statusCode: responseStatus,
        payloadStatus,
      };
    }

    return {
      ok: true,
      detail: `Health endpoint reachable with status '${payloadStatus}'.`,
      statusCode: responseStatus,
      payloadStatus,
    };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      detail: `Health endpoint probe failed: ${detail}`,
      statusCode: responseStatus,
      payloadStatus,
    };
  }
}

export interface PreflightOptions {
  healthUrl?: string;
}

export interface PrepareReleaseOptions extends PreflightOptions {
  releaseId?: string;
  retentionLimit?: number;
}

export interface RollbackOptions extends PreflightOptions {
  snapshotId?: string;
  restartCommand?: string;
}

export interface ReleasePipelineOptions {
  workspaceRoot?: string;
  releaseRootDir?: string;
  retentionLimit?: number;
  commandRunner?: CommandRunner;
  healthProbe?: HealthProbe;
  now?: () => Date;
}

export class ReleasePipelineService {
  readonly #workspaceRoot: string;
  readonly #releaseRootDir: string;
  readonly #snapshotsDir: string;
  readonly #manifestsDir: string;
  readonly #retentionLimit: number;
  readonly #commandRunner: CommandRunner;
  readonly #healthProbe: HealthProbe;
  readonly #now: () => Date;

  constructor(options: ReleasePipelineOptions = {}) {
    this.#workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.#releaseRootDir = options.releaseRootDir ?? path.join(this.#workspaceRoot, 'memory', 'release-pipeline');
    this.#snapshotsDir = path.join(this.#releaseRootDir, 'snapshots');
    this.#manifestsDir = path.join(this.#releaseRootDir, 'manifests');
    this.#retentionLimit = Math.max(1, options.retentionLimit ?? DEFAULT_RETENTION_LIMIT);
    this.#commandRunner = options.commandRunner ?? defaultCommandRunner;
    this.#healthProbe = options.healthProbe ?? defaultHealthProbe;
    this.#now = options.now ?? (() => new Date());
  }

  async runPreflight(options: PreflightOptions = {}): Promise<PreflightResult> {
    const healthUrl = options.healthUrl ?? DEFAULT_HEALTH_URL;
    const checks: ReleaseCheckResult[] = [];

    checks.push(await this.#runCommandCheck('build', 'npm run build', 'Build compilation'));
    checks.push(await this.#runCommandCheck('tests', 'npm run test', 'Test suite'));
    checks.push(await this.#runHealthCheck(healthUrl, 'api-health'));
    checks.push(await this.#runInterfaceReadinessCheck());

    const failedChecks = checks.filter((check) => check.status === 'failed');
    return {
      passed: failedChecks.length === 0,
      checks,
      failedChecks,
    };
  }

  async prepareRelease(options: PrepareReleaseOptions = {}): Promise<ReleaseManifest> {
    await this.#ensureReleaseDirectories();

    const releaseId = options.releaseId ?? `release_${compactTimestamp(this.#now)}`;
    const preflight = await this.runPreflight({ healthUrl: options.healthUrl });
    const appVersion = await this.#resolveAppVersion();
    const gitCommit = await this.#resolveGitCommit();
    const diagnostics = preflight.failedChecks.map(
      (check) => `${check.id}: ${check.detail}`,
    );

    let snapshot: RuntimeSnapshotMetadata | undefined;
    if (preflight.passed) {
      snapshot = await this.createSnapshot({
        releaseId,
        retentionLimit: options.retentionLimit ?? this.#retentionLimit,
      });
    }

    const manifestPath = path.join(this.#manifestsDir, `${releaseId}.json`);
    const manifest: ReleaseManifest = {
      manifestVersion: 1,
      releaseId,
      generatedAt: nowIso(this.#now),
      appVersion,
      gitCommit,
      status: preflight.passed ? 'ready' : 'blocked',
      preflight,
      snapshot: snapshot
        ? {
            snapshotId: snapshot.snapshotId,
            metadataPath: snapshot.metadataPath,
          }
        : undefined,
      artifacts: await this.#collectArtifacts(snapshot),
      diagnostics,
      manifestPath,
    };

    await this.#writeJson(manifestPath, manifest);
    await this.#writeJson(path.join(this.#manifestsDir, 'latest.json'), {
      releaseId: manifest.releaseId,
      manifestPath,
      generatedAt: manifest.generatedAt,
      status: manifest.status,
    });
    await logThought(
      `[ReleasePipeline] Manifest ${manifest.releaseId} generated with status ${manifest.status}.`,
    );

    return manifest;
  }

  async createSnapshot(input: { releaseId: string; retentionLimit?: number }): Promise<RuntimeSnapshotMetadata> {
    await this.#ensureReleaseDirectories();

    const retentionLimit = Math.max(1, input.retentionLimit ?? this.#retentionLimit);
    const snapshotId = `${input.releaseId}_snapshot_${compactTimestamp(this.#now)}`;
    const snapshotDir = path.join(this.#snapshotsDir, snapshotId);
    const snapshotAssetsRoot = path.join(snapshotDir, 'assets');
    await mkdir(snapshotAssetsRoot, { recursive: true });

    const assets: SnapshotAssetRecord[] = [];
    for (const asset of CRITICAL_ASSETS) {
      const sourcePath = path.join(this.#workspaceRoot, asset.relativePath);
      const snapshotPath = path.join(snapshotAssetsRoot, asset.relativePath);
      const exists = await pathExists(sourcePath);

      if (exists) {
        await mkdir(path.dirname(snapshotPath), { recursive: true });
        if (asset.kind === 'directory') {
          await cp(sourcePath, snapshotPath, { recursive: true });
        } else {
          await copyFile(sourcePath, snapshotPath);
        }
      }

      assets.push({
        key: asset.key,
        relativePath: asset.relativePath,
        kind: asset.kind,
        exists,
        sourcePath,
        snapshotPath,
      });
    }

    const metadataPath = path.join(snapshotDir, 'metadata.json');
    const metadata: RuntimeSnapshotMetadata = {
      snapshotId,
      releaseId: input.releaseId,
      createdAt: nowIso(this.#now),
      retentionLimit,
      assets,
      metadataPath,
    };
    await this.#writeJson(metadataPath, metadata);
    await this.#pruneSnapshots(retentionLimit);
    await logThought(
      `[ReleasePipeline] Snapshot ${snapshotId} captured with ${assets.length} critical asset(s).`,
    );
    return metadata;
  }

  async rollback(options: RollbackOptions = {}): Promise<RollbackResult> {
    await this.#ensureReleaseDirectories();

    const startedAt = nowIso(this.#now);
    const snapshot = await this.#resolveSnapshotForRollback(options.snapshotId);
    const statePath = path.join(this.#releaseRootDir, 'rollback-state.json');
    const previousState = await this.#readJson<RollbackState>(statePath);

    if (
      previousState &&
      previousState.snapshotId === snapshot.snapshotId &&
      previousState.status === 'success'
    ) {
      const healthCheck = await this.#runHealthCheck(
        options.healthUrl ?? DEFAULT_HEALTH_URL,
        'api-health',
      );
      const noopResult: RollbackResult = {
        status: healthCheck.status === 'passed' ? 'noop' : 'failed',
        snapshotId: snapshot.snapshotId,
        startedAt,
        completedAt: nowIso(this.#now),
        restoredAssets: [],
        skippedAssets: [],
        healthCheck,
        diagnostics:
          healthCheck.status === 'passed'
            ? [`Snapshot ${snapshot.snapshotId} was already restored; no changes applied.`]
            : [
                `Snapshot ${snapshot.snapshotId} was previously restored, but post-rollback health verification failed.`,
              ],
      };
      await this.#appendRollbackAudit(noopResult);
      return noopResult;
    }

    await this.#writeJson(statePath, {
      snapshotId: snapshot.snapshotId,
      status: 'in_progress',
      updatedAt: nowIso(this.#now),
      detail: 'Rollback started.',
    } satisfies RollbackState);

    const restoredAssets: string[] = [];
    const skippedAssets: string[] = [];
    try {
      for (const asset of snapshot.assets) {
        if (!asset.exists) {
          skippedAssets.push(asset.relativePath);
          continue;
        }

        const sourceExists = await pathExists(asset.snapshotPath);
        if (!sourceExists) {
          throw new Error(`Snapshot asset is missing: ${asset.snapshotPath}`);
        }

        await mkdir(path.dirname(asset.sourcePath), { recursive: true });
        if (asset.kind === 'directory') {
          await rm(asset.sourcePath, { recursive: true, force: true });
          await cp(asset.snapshotPath, asset.sourcePath, { recursive: true });
        } else {
          await copyFile(asset.snapshotPath, asset.sourcePath);
        }
        restoredAssets.push(asset.relativePath);
      }

      if (options.restartCommand) {
        const restartResult = await this.#commandRunner(options.restartCommand, this.#workspaceRoot);
        if (!restartResult.ok) {
          throw new Error(
            `Restart command failed with exit code ${restartResult.exitCode}: ${summarizeOutput(restartResult.output)}`,
          );
        }
      }

      const healthCheck = await this.#runHealthCheck(
        options.healthUrl ?? DEFAULT_HEALTH_URL,
        'api-health',
      );
      if (healthCheck.status === 'failed') {
        throw new Error(`Rollback restored snapshot but health verification failed: ${healthCheck.detail}`);
      }

      const result: RollbackResult = {
        status: 'restored',
        snapshotId: snapshot.snapshotId,
        startedAt,
        completedAt: nowIso(this.#now),
        restoredAssets,
        skippedAssets,
        healthCheck,
        diagnostics: [`Rollback restored snapshot ${snapshot.snapshotId} successfully.`],
      };

      await this.#writeJson(statePath, {
        snapshotId: snapshot.snapshotId,
        status: 'success',
        updatedAt: nowIso(this.#now),
        detail: 'Rollback completed successfully.',
      } satisfies RollbackState);
      await this.#appendRollbackAudit(result);
      await logThought(
        `[ReleasePipeline] Rollback completed for snapshot ${snapshot.snapshotId}.`,
      );
      return result;
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      const failedHealthCheck: ReleaseCheckResult = {
        id: 'api-health',
        status: 'failed',
        detail: `Rollback aborted before healthy confirmation: ${detail}`,
        startedAt: nowIso(this.#now),
        completedAt: nowIso(this.#now),
        durationMs: 0,
      };
      const failedResult: RollbackResult = {
        status: 'failed',
        snapshotId: snapshot.snapshotId,
        startedAt,
        completedAt: nowIso(this.#now),
        restoredAssets,
        skippedAssets,
        healthCheck: failedHealthCheck,
        diagnostics: [detail],
      };

      await this.#writeJson(statePath, {
        snapshotId: snapshot.snapshotId,
        status: 'failed',
        updatedAt: nowIso(this.#now),
        detail,
      } satisfies RollbackState);
      await this.#appendRollbackAudit(failedResult);
      await logThought(
        `[ReleasePipeline] Rollback failed for snapshot ${snapshot.snapshotId}: ${detail}`,
      );
      return failedResult;
    }
  }

  async #runCommandCheck(
    id: Extract<ReleaseCheckId, 'build' | 'tests'>,
    command: string,
    label: string,
  ): Promise<ReleaseCheckResult> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const run = await this.#commandRunner(command, this.#workspaceRoot);
    const completedAt = nowIso(this.#now);

    return {
      id,
      status: run.ok ? 'passed' : 'failed',
      detail: run.ok
        ? `${label} passed.`
        : `${label} failed (exit ${run.exitCode}). ${summarizeOutput(run.output)}`,
      command,
      startedAt,
      completedAt,
      durationMs: run.durationMs,
    };
  }

  async #runHealthCheck(healthUrl: string, id: Extract<ReleaseCheckId, 'api-health'>): Promise<ReleaseCheckResult> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const probe = await this.#healthProbe(healthUrl);
    const completedAt = nowIso(this.#now);
    return {
      id,
      status: probe.ok ? 'passed' : 'failed',
      detail: probe.detail,
      command: `GET ${healthUrl}`,
      startedAt,
      completedAt,
      durationMs: Date.now() - started,
    };
  }

  async #runInterfaceReadinessCheck(): Promise<ReleaseCheckResult> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const required = [
      path.join(this.#workspaceRoot, 'gui', 'package.json'),
      path.join(this.#workspaceRoot, 'src', 'interfaces', 'dispatcher.ts'),
      path.join(this.#workspaceRoot, 'mcp-servers.json'),
    ];

    const missing: string[] = [];
    for (const target of required) {
      if (!(await pathExists(target))) {
        missing.push(path.relative(this.#workspaceRoot, target));
      }
    }

    return {
      id: 'interface-readiness',
      status: missing.length === 0 ? 'passed' : 'failed',
      detail:
        missing.length === 0
          ? 'Critical interface assets are present.'
          : `Missing critical interface assets: ${missing.join(', ')}`,
      startedAt,
      completedAt: nowIso(this.#now),
      durationMs: Date.now() - started,
    };
  }

  async #resolveAppVersion(): Promise<string> {
    const packagePath = path.join(this.#workspaceRoot, 'package.json');
    const raw = await readFile(packagePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isObjectRecord(parsed) || typeof parsed.version !== 'string') {
      throw new Error('Unable to resolve package.json version for release manifest.');
    }
    return parsed.version;
  }

  async #resolveGitCommit(): Promise<string | null> {
    const result = await this.#commandRunner('git --no-pager rev-parse HEAD', this.#workspaceRoot);
    if (!result.ok) {
      return null;
    }
    const commit = result.output.trim().split('\n').at(-1);
    return commit && commit.length > 0 ? commit : null;
  }

  async #collectArtifacts(snapshot?: RuntimeSnapshotMetadata): Promise<ArtifactPointer[]> {
    const pointers: ArtifactPointer[] = [];
    const distPath = path.join(this.#workspaceRoot, 'dist');
    pointers.push({
      id: 'dist',
      path: distPath,
      exists: await pathExists(distPath),
    });
    const runtimeDbPath = path.join(this.#workspaceRoot, 'memory', 'twinclaw.db');
    pointers.push({
      id: 'runtime-db',
      path: runtimeDbPath,
      exists: await pathExists(runtimeDbPath),
    });
    if (snapshot) {
      pointers.push({
        id: 'snapshot-metadata',
        path: snapshot.metadataPath,
        exists: await pathExists(snapshot.metadataPath),
      });
    }
    return pointers;
  }

  async #resolveSnapshotForRollback(snapshotId?: string): Promise<RuntimeSnapshotMetadata> {
    const targetSnapshotId = snapshotId ?? (await this.#latestSnapshotId());
    if (!targetSnapshotId) {
      throw new Error('No snapshots are available for rollback.');
    }

    const metadataPath = path.join(this.#snapshotsDir, targetSnapshotId, 'metadata.json');
    const metadata = await this.#readJson<RuntimeSnapshotMetadata>(metadataPath);
    if (!metadata) {
      throw new Error(`Snapshot metadata not found for '${targetSnapshotId}'.`);
    }
    if (metadata.snapshotId !== targetSnapshotId) {
      throw new Error(`Snapshot metadata mismatch for '${targetSnapshotId}'.`);
    }
    return metadata;
  }

  async #latestSnapshotId(): Promise<string | undefined> {
    if (!(await pathExists(this.#snapshotsDir))) {
      return undefined;
    }
    const entries = await readdir(this.#snapshotsDir, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    return candidates[0];
  }

  async #pruneSnapshots(retentionLimit: number): Promise<void> {
    if (!(await pathExists(this.#snapshotsDir))) {
      return;
    }
    const entries = await readdir(this.#snapshotsDir, { withFileTypes: true });
    const snapshots = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    const stale = snapshots.slice(retentionLimit);
    for (const snapshotId of stale) {
      await rm(path.join(this.#snapshotsDir, snapshotId), { recursive: true, force: true });
    }
  }

  async #appendRollbackAudit(result: RollbackResult): Promise<void> {
    const auditPath = path.join(this.#releaseRootDir, 'rollback-audit.log');
    await mkdir(path.dirname(auditPath), { recursive: true });
    await appendFile(auditPath, `${JSON.stringify(result)}\n`, 'utf8');
  }

  async #ensureReleaseDirectories(): Promise<void> {
    await mkdir(this.#snapshotsDir, { recursive: true });
    await mkdir(this.#manifestsDir, { recursive: true });
  }

  async #writeJson(filePath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  async #readJson<T>(filePath: string): Promise<T | undefined> {
    try {
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }
}
