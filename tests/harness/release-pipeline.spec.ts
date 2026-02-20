import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../src/utils/logger.js', () => ({
  logThought: vi.fn(async () => undefined),
}));

import { ReleasePipelineService } from '../../src/services/release-pipeline.js';
import type { CommandExecutionResult, CommandRunner, HealthProbe } from '../../src/types/release.js';

describe('ReleasePipelineService', () => {
  const createdWorkspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(
      createdWorkspaces.splice(0).map((workspace) =>
        rm(workspace, { recursive: true, force: true }),
      ),
    );
  });

  it('creates a release manifest and snapshot when preflight passes', async () => {
    const workspace = await createWorkspace();
    createdWorkspaces.push(workspace);
    const service = new ReleasePipelineService({
      workspaceRoot: workspace,
      commandRunner: createRunner(),
      healthProbe: createHealthyProbe(),
    });

    const manifest = await service.prepareRelease({ healthUrl: 'http://health.local/ready' });

    expect(manifest.status).toBe('ready');
    expect(manifest.preflight.passed).toBe(true);
    expect(manifest.snapshot?.snapshotId).toBeDefined();
    expect(manifest.snapshot?.metadataPath).toBeDefined();
    expect(await fileExists(manifest.manifestPath)).toBe(true);
    expect(await fileExists(manifest.snapshot!.metadataPath)).toBe(true);
  });

  it('blocks release manifests when preflight checks fail with subsystem diagnostics', async () => {
    const workspace = await createWorkspace();
    createdWorkspaces.push(workspace);
    const service = new ReleasePipelineService({
      workspaceRoot: workspace,
      commandRunner: createRunner({
        'npm run test': {
          ok: false,
          exitCode: 1,
          output: 'Vitest detected regressions in rollback smoke test.',
        },
      }),
      healthProbe: createHealthyProbe(),
    });

    const manifest = await service.prepareRelease({ healthUrl: 'http://health.local/ready' });

    expect(manifest.status).toBe('blocked');
    expect(manifest.snapshot).toBeUndefined();
    expect(manifest.preflight.passed).toBe(false);
    expect(manifest.diagnostics.some((detail) => detail.includes('tests'))).toBe(true);
  });

  it('restores snapshots and remains idempotent on repeated rollback', async () => {
    const workspace = await createWorkspace();
    createdWorkspaces.push(workspace);
    const service = new ReleasePipelineService({
      workspaceRoot: workspace,
      commandRunner: createRunner(),
      healthProbe: createHealthyProbe(),
    });
    const manifest = await service.prepareRelease({ healthUrl: 'http://health.local/ready' });

    const identityPath = path.join(workspace, 'identity', 'identity.md');
    const dbPath = path.join(workspace, 'memory', 'twinclaw.db');
    await writeFile(identityPath, 'mutated identity', 'utf8');
    await writeFile(dbPath, 'mutated db', 'utf8');

    const firstRollback = await service.rollback({
      snapshotId: manifest.snapshot!.snapshotId,
      healthUrl: 'http://health.local/ready',
    });
    const secondRollback = await service.rollback({
      snapshotId: manifest.snapshot!.snapshotId,
      healthUrl: 'http://health.local/ready',
    });

    expect(firstRollback.status).toBe('restored');
    expect(secondRollback.status).toBe('noop');
    expect(await readFile(identityPath, 'utf8')).toBe('identity baseline');
    expect(await readFile(dbPath, 'utf8')).toBe('db baseline');
  });

  it('reports partial rollback failures and succeeds after interrupted snapshot repair', async () => {
    const workspace = await createWorkspace();
    createdWorkspaces.push(workspace);
    const service = new ReleasePipelineService({
      workspaceRoot: workspace,
      commandRunner: createRunner(),
      healthProbe: createHealthyProbe(),
    });
    const manifest = await service.prepareRelease({ healthUrl: 'http://health.local/ready' });
    const metadata = JSON.parse(
      await readFile(manifest.snapshot!.metadataPath, 'utf8'),
    ) as { assets: Array<{ key: string; snapshotPath: string; exists: boolean }> };
    const identitySnapshotAsset = metadata.assets.find(
      (asset) => asset.key === 'identity' && asset.exists,
    );
    if (!identitySnapshotAsset) {
      throw new Error('Expected identity snapshot asset to exist for rollback test.');
    }

    await rm(identitySnapshotAsset.snapshotPath, { recursive: true, force: true });
    await writeFile(path.join(workspace, 'identity', 'identity.md'), 'changed after release', 'utf8');

    const failedRollback = await service.rollback({
      snapshotId: manifest.snapshot!.snapshotId,
      healthUrl: 'http://health.local/ready',
    });
    expect(failedRollback.status).toBe('failed');
    expect(failedRollback.diagnostics[0]).toContain('Snapshot asset is missing');

    await mkdir(identitySnapshotAsset.snapshotPath, { recursive: true });
    await writeFile(path.join(identitySnapshotAsset.snapshotPath, 'identity.md'), 'identity baseline', 'utf8');
    const recoveredRollback = await service.rollback({
      snapshotId: manifest.snapshot!.snapshotId,
      healthUrl: 'http://health.local/ready',
    });
    expect(recoveredRollback.status).toBe('restored');
    expect(await readFile(path.join(workspace, 'identity', 'identity.md'), 'utf8')).toBe('identity baseline');
  });
});

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'twinclaw-release-'));

  await mkdir(path.join(workspace, 'memory'), { recursive: true });
  await mkdir(path.join(workspace, 'identity'), { recursive: true });
  await mkdir(path.join(workspace, 'gui'), { recursive: true });
  await mkdir(path.join(workspace, 'src', 'interfaces'), { recursive: true });
  await mkdir(path.join(workspace, 'dist'), { recursive: true });

  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'twinclaw-test', version: '9.9.9' }),
    'utf8',
  );
  await writeFile(path.join(workspace, 'mcp-servers.json'), '{}', 'utf8');
  await writeFile(path.join(workspace, 'memory', 'twinclaw.db'), 'db baseline', 'utf8');
  await writeFile(path.join(workspace, 'identity', 'identity.md'), 'identity baseline', 'utf8');
  await writeFile(path.join(workspace, 'gui', 'package.json'), JSON.stringify({ name: 'gui-test' }), 'utf8');
  await writeFile(path.join(workspace, 'src', 'interfaces', 'dispatcher.ts'), 'export {};', 'utf8');

  return workspace;
}

function createHealthyProbe(): HealthProbe {
  return async () => ({
    ok: true,
    detail: 'Health endpoint reachable with status ok.',
    statusCode: 200,
    payloadStatus: 'ok',
  });
}

function createRunner(
  overrides: Record<string, Partial<CommandExecutionResult>> = {},
): CommandRunner {
  return async (command: string) => {
    const result = overrides[command];
    if (result) {
      return {
        ok: result.ok ?? true,
        exitCode: result.exitCode ?? (result.ok === false ? 1 : 0),
        output: result.output ?? '',
        durationMs: result.durationMs ?? 5,
      };
    }

    if (command.includes('git --no-pager rev-parse HEAD')) {
      return {
        ok: true,
        exitCode: 0,
        output: '0123456789abcdef0123456789abcdef01234567',
        durationMs: 1,
      };
    }

    return {
      ok: true,
      exitCode: 0,
      output: `${command} completed`,
      durationMs: 5,
    };
  };
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await readFile(targetPath, 'utf8');
    return true;
  } catch {
    return false;
  }
}
